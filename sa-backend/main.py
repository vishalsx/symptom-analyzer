import json
import pdfplumber
import re
import os
import logging
import uuid
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnableParallel, RunnablePassthrough, RunnableLambda
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.memory import ConversationSummaryMemory

# FastAPI app setup
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://pocket-doctor-ohey.onrender.com", "http://localhost:3000" ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_origin_regex=r"https?://.*",

)

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")


# Load environment
load_dotenv()
api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    raise ValueError("GOOGLE_API_KEY not set in .env file.")

# Session memory dictionary
session_memories: Dict[str, ConversationSummaryMemory] = {}

# File handler
async def get_file(file: Optional[UploadFile] = File(None)) -> Optional[UploadFile]:
    return file if file and file.filename else None

async def process_pdf(file: UploadFile) -> str:
    try:
        with pdfplumber.open(file.file) as pdf:
            return "".join([page.extract_text() or "" for page in pdf.pages])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading PDF: {str(e)}")

# LLM and memory initialization
llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", google_api_key=api_key)

# Prompt
prompt = ChatPromptTemplate.from_template("""
You are an expert medical assistant in the areas of modern medicines and also home remedies including Ayurveda.
Your goal is to help diagnose a patient's condition and suggest modern as well as natural homemade medications based on the input provided.
Your default language is English and You should respond in the same language and in the same language script, unless the user deliberately requests to change the language or script. (For example if user responds in hindi then ask "आपका नाम, उम्र, और लिंग क्या है?").
Try and address the user with his or her name as much as you can.                                                                               

** Conversation Flow:
- If any demographic information (name, age, gender) is not provided in the input or history, ask for missing specific information : 'for e.g. Could you please tell me your name, age, and gender?'.
- Once demographic information is detected (e.g., name, age, gender), ask the necessary questions to identify the problem (for e.g, 'What symptoms are you experiencing?')
- For each symptom provided (e.g., headache, nausea), ask follow-up questions to gather details, such as severity, duration, any other symptoms..
  - After collecting sufficient symptoms with details, provide a diagnosis including:
  - Condition name (you can use medical terminology here)
  - Probability (confidence level as a float between 0 and 1)
  - Provide a short medical genesis of this disease if it exists                                        
  - Recommend medical tests to be done if needed, to further diagnose the problem (for e.g. blood test, urine test, etc.)
  - Recommend modern medications (e.g., paracetamol for fever, ibuprofen for pain, etc.) based on the symptoms provided.
  - Recommend lifestyle changes (e.g., rest, hydration, diet changes) based on the symptoms provided.
  - Recommend any precaution which the user must take to avoid aggravation of the current condition(e.g , avoid spicy food, rest, etc.)
  - Provide Local home remedy tailored by region if available (e.g., kadha in North India, rasam in South India, ajwain in Gujarat, etc.). You can provide specific home remedies based on the region of India if applicable.
  - Also ensure that the final diagnosis response is converted into the same language and script as the user input.                                        
  - You must add a polite Goodbye message appended to the home_remedy detalis within the same string. Do not create a new string outside of the home remedy details.
  
** Mandatory considerations:
- It is Mandatory to add a polite Goodbye message at the end of home remedy details withing the same string. 
- Indent every sentence in a new line.                                         
- If diagnosis can't be determined even after multiple questions and responses due to insufficient details or conflicting symptoms, advise: “Unable to determine the condition conclusively. Please consult a qualified doctor for further evaluation.”
- If the user provides a response which is out of context or irrelevant then rephrase the last question and ask it again.

** Ensure that you:
- Do not change the language on your own, unless user requests it (e.g., "Please respond in Hindi", "please hindi me bole" ..).
- Do not provide any medical advice that is not based on the symptoms provided.
- Do not Provide any information that is not related to the medical condition or home remedies.
- Do not combine multiple questions in a single response. Try and ask one question at a time.
- Do not overwhelm the patient/user with too many questions at once. Ask one question at a time and wait for the response before proceeding.
- Do not make very long paragraphs in the final diagnosis, keep the final diagnosis short and in concise sentences buletted.    

                                                                                     
**Respond in strict JSON format with the following structure:
1. While asking questions: {{"question": "string", "diagnosis": null, "home_remedy": null}}
2. When providing diagnosis: {{"question": null, "diagnosis": {{"condition": "string", "probability": float, "medical_tests": ["string"], "modern_medication": ["string"], "lifestyle_changes": ["string"], "precautions": "string"}}, "home_remedy": "string"}}
3. If diagnosis is unclear: {{"question": null, "diagnosis": null, "home_remedy": null}}
4. Ensure the response is valid JSON, without markdown code blocks (e.g., no ```json wrapping).
5. Prevent at all costs an invalid JSON generation.
                                          
Previous conversation: {chat_history}
Patient input: {input}
""")

def parse_response(response: str) -> Dict:
    try:
        # Try to extract JSON between ```json and ```
        json_match = re.search(r"```json\s*(.*?)\s*```", response, re.DOTALL)
        if json_match:
            cleaned = json_match.group(1).strip()
        else:
            # Fallback: try to extract first {...} or [...]
            json_match = re.search(r"(\{.*\}|\[.*\])", response, re.DOTALL)
            if json_match:
                cleaned = json_match.group(1).strip()
            else:
                raise ValueError("No JSON found in LLM response")

        # Parse JSON
        parsed = json.loads(cleaned)

        # Ensure it's a dict
        if not isinstance(parsed, dict):
            raise ValueError(f"Expected JSON object but got {type(parsed).__name__}")

        # Clean up '**' and excessive whitespace
        if parsed.get("question") and isinstance(parsed["question"], str):
            parsed["question"] = parsed["question"].replace("**", "").strip()

        if parsed.get("diagnosis") and isinstance(parsed["diagnosis"], dict):
            for key, value in parsed["diagnosis"].items():
                if isinstance(value, str):
                    parsed["diagnosis"][key] = value.replace("**", "").strip()
                elif isinstance(value, list):
                    parsed["diagnosis"][key] = [
                        item.replace("**", ".").strip() if isinstance(item, str) else item
                        for item in value
                    ]

        if parsed.get("home_remedy") and isinstance(parsed["home_remedy"], str):
            parsed["home_remedy"] = (
                parsed["home_remedy"]
                .replace("**", "")          # Remove markdown bold markers
                .replace("\r\n", "\n")      # Normalize Windows newlines
                .replace("\r", "\n")        # Normalize old Mac newlines
            )
            # Collapse multiple blank lines into a single newline
            parsed["home_remedy"] = re.sub(r"\n\s*\n", "\n", parsed["home_remedy"]).strip()

        return {
            "question": parsed.get("question"),
            "diagnosis": parsed.get("diagnosis"),
            "home_remedy": parsed.get("home_remedy")
        }

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON: {e} | Raw cleaned: {cleaned if 'cleaned' in locals() else 'N/A'} | Full raw: {response}")
    except Exception as e:
        logger.error(f"Unexpected error: {e} | Raw response: {response}")

    return {
        "question": "Oh.. something went wrong while processing your input. Please try to re-enter your last response.",
        "diagnosis": None,
        "home_remedy": None
    }


# Get or create session-specific memory
def get_session_memory(session_id: str) -> ConversationSummaryMemory:
    if session_id not in session_memories:
        session_memories[session_id] = ConversationSummaryMemory(llm=llm, memory_key="chat_history", return_messages=True, output_key="response")
        logger.info(f"Created new memory instance for session: {session_id}")
    return session_memories[session_id]

# LangChain runnable chain with session-specific memory
def get_chain(session_id: str):
    memory = get_session_memory(session_id)
    return (
        RunnableParallel({
            "input": RunnablePassthrough(),
            "chat_history": RunnableLambda(lambda _: memory.load_memory_variables({}).get("chat_history", []))
        })
        | prompt
        | llm
        | StrOutputParser()
        | RunnableLambda(parse_response)
    )

# Pydantic models
class Message(BaseModel):
    id: str
    text: str
    isUser: bool
    timestamp: str

class ChatResponse(BaseModel):
    question: Optional[str] = None
    diagnosis: Optional[Dict] = None
    home_remedy: Optional[str] = None

# Main API endpoint
@app.post("/api/chat", response_model=ChatResponse)
async def chat(
    request: Request,
    message: Optional[str] = Form(None),
    history: Optional[str] = Form(None),
    file: Optional[UploadFile] = Depends(get_file)
):
    try:
        form_data = await request.form()
        logger.info(f"Received raw request: {dict(form_data)}")

        # Extract session ID from headers, fallback to new UUID if not present
        session_id = request.headers.get("X-Session-ID", str(uuid.uuid4()))
        logger.info(f"Processing request for session ID: {session_id}")

        # Build input string
        input_text = ""
        if file:
            input_text += await process_pdf(file)
        if message:
            input_text += "\n" + message

        if not input_text.strip():
            raise HTTPException(status_code=400, detail="No input message or file provided.")

        # Get chain for this session
        chain = get_chain(session_id)
        result = chain.invoke(input_text)
        logger.info(f"Parsed response for session {session_id}: {result}")

        # Store context for session-specific memory
        memory = get_session_memory(session_id)
        memory.save_context({"input": input_text}, {"response": json.dumps(result)})

        # Check if this is a final response and close the session
        if result.get("question") is None:  # Final response (diagnosis or unclear)
            if session_id in session_memories:
                del session_memories[session_id]
                logger.info(f"Closed session {session_id} after final response")

        return result

    except Exception as e:
        logger.exception(f"Server error for session {session_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")