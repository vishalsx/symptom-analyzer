import React, { useState, useEffect, useRef } from 'react';
import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Define Web Speech API types
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (event: SpeechRecognitionEvent) => void;
  onend: () => void;
  onerror: (event: { error: string }) => void;
  start: () => void;
  stop: () => void;
}
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  transcript: string;
}

interface Message {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: string;
}
interface Diagnosis {
  condition: string;
  probability: number;
  medical_tests: string[];
  modern_medication: string[];
  lifestyle_changes: string[];
  precautions: string[];
}
interface ChatResponse {
  question: string | null;
  diagnosis: Diagnosis | null;
  home_remedy: string | null;
  diet_plan: string | null;
}
interface ApiError {
  detail?: string;
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [sessionId] = useState(uuidv4());
  const [showDietOption, setShowDietOption] = useState(false); // New state for diet plan prompt
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiUrlRef = useRef<string>('');
  const chatMode = useRef<string>('Diagnosis'); // Use ref to store chat mode
  const conditionRef = useRef<string>('Unknown'); // Store condition from the last response from diagnosis
  const [isFileDisabled, setIsFileDisabled] = useState(false); 
  
  
  const diagUrl = process.env.REACT_APP_FASTAPI_CHAT_URL || 'http://localhost:5000/api/chat';
  const dietUrl = process.env.REACT_APP_FASTAPI_DIET_URL || 'http://localhost:5000/api/diet';

  apiUrlRef.current = diagUrl; // Default to diagnosis URL


  /** ⌨️ Adaptive typing animation helper */
  const typeMessage = (fullText: string) => {
    return new Promise<void>((resolve) => {
      setIsTyping(true);
      let index = 0;
      let currentText = '';

      const typeNextChar = () => {
        if (index < fullText.length) {
          currentText += fullText[index];
          index++;

          // Update last bot message dynamically
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              text: currentText,
            };
            return updated;
          });

          // Adaptive speed based on content length
          const speed = fullText.length > 100 ? 5 : 50;
          setTimeout(typeNextChar, speed);
        } else {
          setIsTyping(false);
          resolve();
        }
      };

      typeNextChar();
    });
  };

   /** 🎉 Welcome message */
   useEffect(() => {
    const welcomeText =
      "👋 Welcome to your personal Pocket Doctor. Let's begin with your details like your name, age, and gender.\n💡 You can also type or speak in a language you are comfortable with.\n";

    // Add placeholder bot message first
    setMessages([
      { id: 'welcome-msg', text: '', isUser: false, timestamp: new Date().toISOString() },
    ]);

    setTimeout(() => {
      typeMessage(welcomeText);
    }, 500);
  }, []);


   /** 🎤 Speech recognition setup */
    useEffect(() => {
      const setupSpeechRecognition = async () => {
        if ('webkitSpeechRecognition' in window) {
          try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            const SRConstructor = (window as any).webkitSpeechRecognition as new () => SpeechRecognition;
            recognitionRef.current = new SRConstructor();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = false;
            recognitionRef.current.lang = 'en-US';
  
            recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
              const transcript = event.results[0][0].transcript;
              setInput((prev) => prev + (prev ? ' ' : '') + transcript);
              setIsRecording(false);
            };
            recognitionRef.current.onend = () => setIsRecording(false);
            recognitionRef.current.onerror = (event: { error: string }) => {
              setError(`Speech recognition error: ${event.error}`);
              setIsRecording(false);
            };
          } catch {
            setError('Microphone access denied. Please allow microphone permissions in your browser settings.');
          }
        } else {
          setError('Speech recognition not supported in this browser.');
        }
      };
      setupSpeechRecognition();
    }, [isRecording]);
  

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      recognitionRef.current?.start();
      setIsRecording(true);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFile(e.target.files[0]);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const sendMessage = async () => {
    if ( (isLoading || (!input.trim() && !file) ) && chatMode.current === "Diagnosis") return;

    setIsLoading(true);
    setError(null);
    const newMessage: Message = {
      id: uuidv4(),
      text: input,
      isUser: true,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMessage]);
    setInput('');
    
    if (chatMode.current === "Diagnosis" || chatMode.current === null) {
      apiUrlRef.current = diagUrl; // Set API URL for diagnosis mode
      setIsFileDisabled(false); // Enable file upload in diagnosis mode
    } else if( chatMode.current === "Diet") {  
        apiUrlRef.current = dietUrl; 
        setIsFileDisabled(true); // Disable file upload in diet mode
        setShowDietOption(false); // Hide the option after selection// Set API URL for diet mode
      }

    try {
      const formData = new FormData();
      if (file) formData.append('file', file);
      if (input.trim()) formData.append('message', input.trim());
      if (conditionRef.current) formData.append('condition', conditionRef.current);
      

      const response = await axios.post<ChatResponse>(apiUrlRef.current, formData, {
        headers: {
          'X-Session-ID': sessionId,
          'Content-Type': 'multipart/form-data',
        },
        timeout: 90000, // 90 seconds timeout
      });

      
      /*parsing response data to display in chat */

      let botText = '';
      
      
      if (response.data.question !== null) {
        botText = response.data.question || 'No question received.';
      } else if (response.data.diagnosis && response.data.home_remedy) {
        botText = `🌡️ Condition: ${response.data.diagnosis.condition}\nProbability: ${
          response.data.diagnosis.probability * 100
        }%\n💉 Medical Tests:\n ${response.data.diagnosis.medical_tests}\n💊Medication:\n ${
          response.data.diagnosis.modern_medication
        }\n🏖️ Lifestyle Changes:\n ${response.data.diagnosis.lifestyle_changes}\n‼️Precautions:\n ${
          response.data.diagnosis.precautions
        }\n🌿 Home Remedy:\n ${response.data.home_remedy}`;
        
        chatMode.current = "Diet"; // Set chat mode to Diet as this is the end of diagnosis mode       
        conditionRef.current = `${response.data.diagnosis.condition || 'Unknown'}`; // Store the condition for diet plan request

      } else if (response.data.diagnosis == null && response.data.diet_plan) {
        botText = `🥗 Recommended Diet Plan:\n ${response.data.diet_plan}`;
        chatMode.current = "Diagnosis"; // Resdet chat mode back to Diagnosis as this is the end of diet mode
        conditionRef.current = 'Unknown' ;// Reset the condition to null again as the diet plan is published.
      }
      else {
        botText = 'Unable to determine the condition conclusively. Please consult a qualified doctor.';
      }

      const botMessage: Message = {
        id: uuidv4(),
        text: '',
        isUser: false,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, botMessage]);

      await typeMessage(botText);

      // Check if diagnosis is final and show diet option
      if (response.data.question === null && response.data.diagnosis) {
        setShowDietOption(true);
      }
    } catch (err) {
      const error = err as AxiosError<ApiError>;
      setError(error.response?.data.detail || 'An error occurred. Please try again.');
    } finally {
      setIsLoading(false);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // RequestDietPlan starts here
  
  // const requestDietPlan = async () => {
  //   setIsLoading(true);
  //   setError(null);
  //   setShowDietOption(false); // Hide the option after selection
  
  //   try {
  //     // Find the last diagnosis from messages
      
  //     let condition = null;
  //     condition = `Condition: ${lastresponseRef.current?.diagnosis?.condition || ''}`;

  
  //     // Create a temporary form
  //     const form = document.createElement('form');
  //     form.method = 'POST';
  //     form.action = dietApiUrl;
  
  //     // Add message input
  //     const messageInput = document.createElement('input');
  //     messageInput.type = 'hidden';
  //     messageInput.name = 'message';
  //     messageInput.value = 'Generate my Diet Plan.';
  //     form.appendChild(messageInput);
  
  //     // Add condition input if available
  //     if (condition) {
  //       const conditionInput = document.createElement('input');
  //       conditionInput.type = 'hidden';
  //       conditionInput.name = 'condition';
  //       conditionInput.value = condition;
  //       form.appendChild(conditionInput);
  //     }
  
  //     // Add form to document (hidden)
  //     document.body.appendChild(form);
  
  //     // Convert form to FormData and send with Fetch
  //     const formData = new FormData(form);
  //     const requestBody = new URLSearchParams();
  //     Array.from(formData.entries()).forEach(([key, value]) => {
  //       requestBody.append(key, value as string);
  //     });
  
  //     const response = await fetch(dietApiUrl, {
  //       method: 'POST',
  //       body: requestBody.toString(),
  //       headers: {
  //         'X-Session-ID': sessionId,
  //         'Content-Type': 'application/x-www-form-urlencoded',
  //       },
  //     });
  
  //     if (!response.ok) {
  //       const errorText = await response.text();
  //       throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
  //     }
  
  //     const data = await response.json() as ChatResponse;
  
  //     const botMessage: Message = {
  //       id: uuidv4(),
  //       text: '',
  //       isUser: false,
  //       timestamp: new Date().toISOString(),
  //     };
  //     setMessages((prev) => [...prev, botMessage]);
  
  //     // Parse and type the response
  //     let botText = '';
  //     if (data.question !== null) {
  //       botText = data.question || 'No question received.';
  //     } else if (data.diet_plan) {
  //       botText = `🥗Recommended Diet Plan (Week):\n ${data.diet_plan}`;
  //     } else {
  //       botText = 'No diet plan available.';
  //     }
  //     await typeMessage(botText);
  //   } catch (err) {
  //     const error = err as AxiosError<ApiError> | Error;
  //     const errorDetail = 'response' in error && error.response?.data?.detail || error.message || 'An error occurred while generating the diet plan.';
  //     setError(errorDetail);
  //     console.error('Diet Plan Error:', err);
  //   } finally {
  //     setIsLoading(false);
  //     // Clean up the temporary form
  //     const form = document.querySelector('form');
  //     if (form) document.body.removeChild(form);
  //   }
  // };




  //Reqeust diet plan ends here

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-green-50 flex flex-col items-center p-4">
      {/* Header */}
      <header className="w-full max-w-full md:max-w-5xl bg-white rounded-2xl shadow-md p-4 flex items-center space-x-4">
        <img src="/Symptom-Analyzer-logo.png" alt="Symptom Analyzer Logo"
          className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 object-contain relative top-0 sm:top-1 md:top-1" />
        <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-semibold text-gray-800 tracking-tight">
          I'm your friendly Pocket Doctor
        </h1>
      </header>

      {/* Chat Window */}
      <div className="w-full max-w-full md:max-w-5xl bg-white rounded-2xl shadow-lg flex flex-col min-h-[75vh] mt-4 overflow-hidden">
        <div className="flex-1 p-4 overflow-y-auto space-y-4 scroll-smooth">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[99%] sm:max-w-[99%] p-4 rounded-2xl shadow-sm text-gray-800 animate-fade-in whitespace-pre-wrap break-words ${
                msg.isUser ? 'bg-blue-100' : 'bg-green-50'
              }`}>
                <p className="text-base leading-relaxed">{msg.text}</p>
                <div className="flex justify-end mt-2">
                  <p className="text-xs text-gray-500">{new Date(msg.timestamp).toLocaleTimeString()}</p>
                </div>
              </div>
            </div>
          ))}

          {/* Typing Indicator */}
     

          {error && (
            <div className="text-red-600 text-center text-sm animate-fade-in p-3 bg-red-50 rounded-lg border border-red-200">
              {error}
            </div>
          )}
         
         {showDietOption && (
  <div className="flex flex-wrap justify-center gap-4">
    <button
      onClick={sendMessage} 
      className="px-4 py-2 bg-blue-200 text-gray-800 rounded-xl hover:bg-blue-300 transition-colors disabled:opacity-50"
    >
      Create a diet plan
    </button>

    <button
      onClick={() => console.log("Order Medicines clicked")}
      className="px-4 py-2 bg-green-200 text-gray-800 rounded-xl hover:bg-green-300 transition-colors"
    >
      Order Medicines
    </button>

    <button
      onClick={() => console.log("Video call with Doctor clicked")}
      className="px-4 py-2 bg-purple-200 text-gray-800 rounded-xl hover:bg-purple-300 transition-colors"
    >
      Video call with Doctor
    </button>

    <button
      onClick={() => setShowDietOption(false)}
      className="px-4 py-2 bg-gray-200 text-gray-800 rounded-xl hover:bg-gray-300 transition-colors"
    >
      No, thank you
    </button>
  </div>
)}


          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-100 bg-white flex flex-col space-y-3">
          <div className="flex items-start space-x-3">
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress} placeholder="Tell me about yourself and any problems..."
              className="flex-1 p-4 bg-gray-50 text-gray-800 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 border border-gray-200"
              rows={4} />
            <div className="flex flex-col space-y-2">
              <button onClick={sendMessage} disabled={isRecording || isLoading || (!input.trim() && !file)}
                className="w-20 h-12 px-4 py-3 bg-blue-200 text-gray-800 rounded-xl hover:bg-blue-300 transition-colors disabled:opacity-50">
                {isLoading ? '..⏰..' : 'Send'}
              </button>
              <button onClick={toggleRecording}
                className={`w-20 h-12 px-4 py-3 rounded-xl ${isRecording ? 'bg-red-400 text-white' : 'bg-green-200 text-gray-800'} hover:opacity-90`}>
                <img src="mic-icon.png" alt={isRecording ? 'Stop recording' : 'Start recording'}
                  className="w-6 h-6 mx-auto" />
              </button>
            </div>
          </div>

          {/* File Upload */}
          <div className="flex space-x-3">
            <input type="file" accept=".pdf" onChange={handleFileChange} ref={fileInputRef} disabled={isFileDisabled}
              className="text-gray-800 bg-gray-50 p-3 rounded-xl cursor-pointer border border-gray-200" />
          </div>
        </div>
      </div>
    </div>
  );


};

export default App;