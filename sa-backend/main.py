import json
import pdfplumber
import re
import os
import logging
import uuid
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Depends, Request, Header
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
    allow_origins=["https://pocket-doctor-ohey.onrender.com", "http://localhost:3000"],
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

# LLM initialization
llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.1, google_api_key=api_key)


#       Function to parse the response from LLM
# 
#  


def extract_json_object(text: str) -> str:
    """
    Extract the first complete JSON object from a string.
    This avoids the limitations of regex by matching balanced braces.
    """
    start = text.find('{')
    if start == -1:
        raise ValueError("No opening brace found in response.")

    stack = []
    for i in range(start, len(text)):
        if text[i] == '{':
            stack.append('{')
        elif text[i] == '}':
            stack.pop()
            if not stack:
                return text[start:i + 1]

    raise ValueError("No matching closing brace found in response.")


def clean_markdown(text: str) -> str:
    """Remove markdown artifacts and normalize line breaks."""
    if not isinstance(text, str):
        return text
    text = text.replace("**", "").replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\n\s*\n", "\n", text).strip()

def escape_unescaped_newlines(text: str) -> str:
    """
    Escapes unescaped newline characters that are inside double-quoted JSON strings.
    """
    # This regex finds all strings: " ... "
    pattern = r'"(.*?)"'
    def replacer(match):
        content = match.group(1)
        # Only escape newlines and carriage returns if they exist unescaped
        content_escaped = content.replace('\n', '\\n').replace('\r', '\\r')
        return f'"{content_escaped}"'

    return re.sub(pattern, replacer, text, flags=re.DOTALL)


import json
import re
import logging
from typing import Dict

logger = logging.getLogger(__name__)


def extract_json_object(text: str) -> str:
    """
    Extract the first complete JSON object from a string by matching balanced braces.
    """
    start = text.find('{')
    if start == -1:
        raise ValueError("No opening brace found in response.")

    stack = []
    for i in range(start, len(text)):
        if text[i] == '{':
            stack.append('{')
        elif text[i] == '}':
            stack.pop()
            if not stack:
                return text[start:i + 1]

    raise ValueError("No matching closing brace found in response.")


def escape_unescaped_newlines(text: str) -> str:
    """
    Escapes unescaped newline and carriage return characters inside quoted JSON string values.
    """
    def replacer(match):
        content = match.group(1)
        # Escape only actual newlines and returns (not already escaped ones)
        content = content.replace('\r', '\\r').replace('\n', '\\n')
        return f'"{content}"'

    return re.sub(r'"(.*?)"', replacer, text, flags=re.DOTALL)


def clean_markdown(text: str) -> str:
    """Remove markdown artifacts and normalize line breaks."""
    if not isinstance(text, str):
        return text
    text = text.replace("**", "").replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\n\s*\n", "\n", text).strip()


def parse_response(response: str) -> Dict:
    try:
        # Step 1: Try full response as JSON
        try:
            response_cleaned = escape_unescaped_newlines(response.strip())
            parsed = json.loads(response_cleaned)
        except json.JSONDecodeError:
            # Step 2: Try extracting from ```json ... ``` block
            json_match = re.search(r"```json\s*(.*?)\s*```", response, re.DOTALL)
            if json_match:
                cleaned = escape_unescaped_newlines(json_match.group(1).strip())
                parsed = json.loads(cleaned)
            else:
                # Step 3: Try extracting balanced {...} JSON object
                cleaned = escape_unescaped_newlines(extract_json_object(response))
                parsed = json.loads(cleaned)

        if not isinstance(parsed, dict):
            raise ValueError(f"Expected JSON object but got {type(parsed).__name__}")

        # Clean known fields
        result = {
            "question": clean_markdown(parsed.get("question")),
            "diagnosis": None,
            "home_remedy": clean_markdown(parsed.get("home_remedy")),
            "diet_plan": clean_markdown(parsed.get("diet_plan")),
        }

        diagnosis = parsed.get("diagnosis")
        if isinstance(diagnosis, dict):
            cleaned_diagnosis = {}
            for key, value in diagnosis.items():
                if isinstance(value, str):
                    cleaned_diagnosis[key] = clean_markdown(value)
                elif isinstance(value, list):
                    cleaned_diagnosis[key] = [clean_markdown(item) for item in value]
                else:
                    cleaned_diagnosis[key] = value
            result["diagnosis"] = cleaned_diagnosis

        return result

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON: {e} | Cleaned: {cleaned if 'cleaned' in locals() else 'N/A'} | Full: {response}")
    except Exception as e:
        logger.exception(f"Unexpected error while parsing LLM response: {e}")

    # Fallback response
    return {
        "question": "Sorry, something went wrong while processing your input. Type 'retry' to try again.",
        "diagnosis": None,
        "home_remedy": None,
        "diet_plan": None
    }






# New function to process chat request with all logic embedded
#async def process_chat_request(request: Request, message: Optional[str] = Form(None), history: Optional[str] = Form(None), file: Optional[UploadFile] = Depends(get_file)) -> Dict:
async def process_chat_request(request: Request, message: Optional[str] = Form(None), file: Optional[UploadFile] = Depends(get_file)) -> Dict:
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

        # Inner function to get or create session-specific memory
        def get_session_memory(session_id: str) -> ConversationSummaryMemory:
            if session_id not in session_memories:
                session_memories[session_id] = ConversationSummaryMemory(llm=llm, memory_key="chat_history", return_messages=True, output_key="response")
                logger.info(f"Created new memory instance for session: {session_id}")
            return session_memories[session_id]



        # Inner function to get chain
        def get_chain(session_id: str):
            memory = get_session_memory(session_id)
            return (
                RunnableParallel({
                    "input": RunnablePassthrough(),
                    "chat_history": RunnableLambda(lambda _: memory.load_memory_variables({}).get("chat_history", []))
                })
                | ChatPromptTemplate.from_template("""
You are an expert medical assistant in the areas of modern medicines and also home remedies including Ayurveda.
Your goal is to help diagnose a patient's condition and suggest modern as well as natural homemade medications based on the input provided.
Your default language is English and You should respond in the same language and in the same language script, unless the user requests to change the language or script. (For example if user responds in hindi then ask "आपका नाम, उम्र, और लिंग क्या है?").
Try and address the user with his or her name as much as you can except when the diagnosis is provided.                                                                               

** Conversation Flow:
- If any demographic information (name, age, gender) is not provided in the input or history, ask for missing specific information : 'for e.g. Could you please tell me your name, age, and gender?'.
- Once demographic information is detected (e.g., name, age, gender), ask the necessary questions to identify the problem (for e.g, 'What symptoms are you experiencing?')
- For each symptom provided (e.g., headache, nausea), ask follow-up questions to gather details, such as severity, duration, any other symptoms etc.
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
 
** Mandatory points to consider**
- It is Mandatory to add a polite Goodbye message at the end of home remedy details withing the same string. 
- Indent every sentence in a new line.                                         
- If diagnosis can't be determined even after multiple questions and responses due to insufficient details or conflicting symptoms, advise: “Unable to determine the condition conclusively. Please consult a qualified doctor for further evaluation.”

** Ensure that you:
- Do not change the language on your own, unless user requests it (e.g., "Please respond in Hindi", "please hindi me bole" ..).
- Do not provide any medical advice that is not based on the symptoms provided.
- Do not Provide any information that is not related to the medical condition or home remedies.
- Do not combine multiple questions in a single response. Try and ask one question at a time.
- Do not overwhelm the patient/user with too many questions at once. Ask one question at a time and wait for the response before proceeding.
- Do not make very long paragraphs in the final diagnosis, keep the final diagnosis short and in concise sentences buletted.
                                                                                     
**Respond in strict JSON format with the following structure:
1. While asking questions: {{"question": "string", "diagnosis": null, "home_remedy": null, "diet_plan": null}}
2. When providing diagnosis: {{"question": null, "diagnosis": {{"condition": "string", "probability": float, "medical_tests": ["string"], "modern_medication": ["string"], "lifestyle_changes": ["string"], "precautions": "string"}}, "home_remedy": "string", "diet_plan": null}}
3. If diagnosis is unclear: {{"question": null, "diagnosis": null, "home_remedy": null, "diet_plan": null}}

                                           
Ensure the response is valid JSON, without markdown code blocks (e.g., no ```json wrapping).
                                          
Previous conversation: {chat_history}
Patient input: {input}
""")
                | llm
                | StrOutputParser()
                | RunnableLambda(parse_response)
            )

        # Execute the chain
        chain = get_chain(session_id)
        result = chain.invoke(input_text)
        logger.info(f"Parsed response for session {session_id}: {result}")

        # Store context for session-specific memory
        memory = get_session_memory(session_id)
        memory.save_context({"input": input_text}, {"response": json.dumps(result)})
        
        # Check if this is a final response and close the session
        if result.get("question") is None:  # Final response (diagnosis or unclear)
            if session_id in session_memories:
                #del session_memories[session_id]
                logger.info(f"NOT Closing session {session_id} after final response. On to diet plan")

        return result

    except Exception as e:
        logger.exception(f"Server error for session {session_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

# def get_session_id(request: Request):
#     return request.headers.get("X-Session-ID", str(uuid.uuid4()))

# Function to process diet plan request
async def process_diet_plan(request: Request, message: Optional[str] = Form(None), condition: Optional[str] =  Form(None) ) -> Dict:
    try:
      
        session_id = request.headers.get("X-Session-ID", str(uuid.uuid4()))
        

        logger.info(f"Received diet plan request for session ID: {session_id}")
        logger.info(f"Received message: {message}, \ncondition: {condition}")
        
        if condition is None or condition.strip() == "":
            raise HTTPException(status_code=400, detail="Condition is required for diet planning.")
        # Get session memory
        def get_session_memory(session_id: str) -> ConversationSummaryMemory:
            if session_id not in session_memories:
                session_memories[session_id] = ConversationSummaryMemory(llm=llm, memory_key="chat_history", return_messages=True, output_key="response")
                logger.info(f"Created new memory instance for session: {session_id}")
            return session_memories[session_id]

        memory = get_session_memory(session_id)
        context = memory.load_memory_variables({}).get("chat_history", [])
        logger.info(f"Loaded context for session {session_id}: {context}")

        # Diet planning conversational flow
        input_text = message or ""
        diet_prompt = ChatPromptTemplate.from_template("""
You are an expert dietitian. Based on the diagnosed condition: {condition}, your goal is to create a personalized diet plan for the user.
Previous conversation: {chat_history}
Patient input: {input}                                 

However, before you create the plan, gather the following essential details by asking these questions one by one:
1. Dietary preferences (Veg, Non-veg, Vegan, Jain, etc.)
2. Any food allergies
3. Any food items the user dislikes or wants to avoid.
4. Specific dietary restrictions (e.g. low-carb, high-protein) — assume the answer to be no if no satisfactory response is received
5. Number of days the user wants the diet plan for (default to 7 days if not provided)
6. Any specific health goals (e.g., weight loss, muscle gain, etc.) — assume the answer to be no if no satisfactory response is received
                                                       
**Rules:**
- No markdown formatting (no ```json)
- Respond in the user's language only if they request it
- Do not repeat previously asked or answered questions
- Avoid generic statements or medical advice
- Do not repeat any questions. If the answer is not satisfactory, then assuem it to be the safest vaule and mention it to the user                                        
- Do not ask for re-confirmations on already provided information
- Do not repeast any quesions. Take a safe assumtiopn for unasnwered question, and move on to the next step
- Once required info is collected, generate a clear, day-wise plan (with meal times)
- Take into account the time of the year based on the current date and availabilituy of suggested food items. (For e,g. Oranges are not available in winters, so do not suggest them)
- End with a short, polite goodbye message

**Output format (strict JSON):**
- While asking questions: 
  {{ "question": "your question here", "diagnosis": null, "home_remedy": null, "diet_plan": null }}
- When providing the final plan:
  {{ "question": null, "diagnosis": null, "home_remedy": null, "diet_plan": "final plan string" }}


""")
        chain = (
            RunnableParallel({
                "input": RunnablePassthrough(),
                "chat_history": RunnableLambda(lambda _: context),
                "condition": RunnableLambda(lambda _: condition)
            })
            | diet_prompt
            | llm
            | StrOutputParser()
            | RunnableLambda(parse_response)
        )

        result = chain.invoke(input_text)
        logger.info(f"Diet plan response for session {session_id}: {result}")

        # Update memory with the response
        memory.save_context({"input": input_text}, {"response": json.dumps(result)})

        # Close session if diet plan is provided
        if result.get("question") is None:  # Final response with diet plan
            logger.info(f"Final diet plan provided for session {session_id}: {result.get('diet_plan')}")
            if session_id in session_memories:
                del session_memories[session_id]
                logger.info(f"Closed session {session_id} after diet plan")

        return result

    except Exception as e:
        logger.exception(f"Server error for session {session_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

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
    diet_plan: Optional[str] = None
    condition: Optional[str] = None

# Main API endpoints
@app.post("/api/chat", response_model=ChatResponse)
async def chat(
    request: Request,
    message: Optional[str] = Form(None),
#    history: Optional[str] = Form(None),
    file: Optional[UploadFile] = Depends(get_file)
):
#   return await process_chat_request(request, message, history, file)
    return await process_chat_request(request, message, file)

@app.post("/api/diet", response_model=ChatResponse)
async def diet(
    request: Request,
    message: Optional[str] = Form(None),
    condition: Optional[str] = Form(None),
):
    return await process_diet_plan(request, message, condition)