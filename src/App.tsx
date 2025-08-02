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
// Define diagnosis structure
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
}

// Define backend error response type
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
  const [sessionId] = useState(uuidv4()); // Unique session ID
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiUrl = process.env.REACT_APP_FASTAPI_URL || 'http://localhost:5000/api/chat';

  // Show welcome message on load
  useEffect(() => {
    const timer = setTimeout(() => {
      const welcomeMessage: Message = {
        id: Date.now().toString(),
        text: "👋 Welcome to your personal Pocket Doctor. Let's begin with your details like your name, age, and gender.\n💡 You can also type or speak in a language you are comfortable with..\n",
        isUser: false,
        timestamp: new Date().toISOString(),
      };
      setMessages([welcomeMessage]);
    }, 500); // delay for smooth entry

    return () => clearTimeout(timer);
  }, []);

  // Initialize Web Speech API
  useEffect(() => {
    const setupSpeechRecognition = async () => {
      if ('webkitSpeechRecognition' in window) {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
          const SpeechRecognitionConstructor = (window as any).webkitSpeechRecognition as new () => SpeechRecognition;
          recognitionRef.current = new SpeechRecognitionConstructor();
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
  }, []);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() && !file) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      text: input,
      isUser: true,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInput('');
    setError(null);

    const formData = new FormData();
    if (input.trim()) formData.append('message', input);
    const historyData = messages.map(msg => ({ isUser: msg.isUser, text: msg.text }));
    formData.append('history', JSON.stringify(historyData));
    if (file) formData.append('file', file);

    try {
      setIsLoading(true);
      const response = await axios.post<ChatResponse>(apiUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data', 'X-Session-ID': sessionId },
        timeout: 90000,
      });

      let questionText = '';
      if (response.data.question !== null) {
        questionText = response.data.question || 'No question received.';
      } else if (response.data.diagnosis !== null && response.data.home_remedy !== null) {
        questionText = `Condition: ${response.data.diagnosis.condition}\nProbability: ${response.data.diagnosis.probability * 100}%\n💉Medical Tests:\n ${response.data.diagnosis.medical_tests}\n💊Medication:\n ${response.data.diagnosis.modern_medication}\n🏖️Lifestyle Changes:\n ${response.data.diagnosis.lifestyle_changes}\n‼️Precautions:\n ${response.data.diagnosis.precautions}\n🌿Home Remedy:\n ${response.data.home_remedy}`;
      } else {
        questionText = 'Unable to determine the condition conclusively. Please consult a qualified doctor.';
      }

      const botMessage: Message = {
        id: Date.now().toString(),
        text: questionText,
        isUser: false,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, botMessage]);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      const axiosError = err as AxiosError;
      let errorMessage = 'Error: Network Error';
      if (axiosError.response) {
        const errorData = axiosError.response.data as ApiError;
        errorMessage = `Server Error: ${axiosError.response.status} - ${errorData.detail || axiosError.message}`;
      } else if (axiosError.request) {
        errorMessage = `Network Error: No response received. Timeout: ${axiosError.code === 'ECONNABORTED' ? 'Yes' : 'No'}`;
      } else {
        errorMessage = `Error: ${axiosError.message}`;
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      setError('Speech recognition not initialized. Please refresh the page.');
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(() => {
          recognitionRef.current!.start();
          setIsRecording(true);
        })
        .catch(() => setError('Microphone access denied. Please allow permissions.'));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setError(null);
    } else {
      setError('Please upload a valid PDF file.');
      setFile(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-green-50 flex flex-col items-center p-4">
      {/* Header */}
      <header className="w-full max-w-full md:max-w-5xl bg-white rounded-2xl shadow-md p-4 flex items-center space-x-4">
        <img src="/Symptom-Analyzer-logo.png" alt="Symptom Analyzer Logo"
          className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 object-contain relative top-2 sm:top-2.5 md:top-3" />
        <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-semibold text-gray-800 tracking-tight">
          I'm your friendly Pocket Doctor
        </h1>
      </header>

      {/* Chat Window */}
      <div className="w-full max-w-full md:max-w-5xl bg-white rounded-2xl shadow-lg flex flex-col min-h-[75vh] mt-4 overflow-hidden">
        {/* Messages */}
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
          {error && (
            <div className="text-red-600 text-center text-sm animate-fade-in p-3 bg-red-50 rounded-lg border border-red-200">
              {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-100 bg-white flex flex-col space-y-3">
          <div className="flex items-start space-x-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Tell me about yourself and any problems..."
              className="flex-1 p-4 bg-gray-50 text-gray-800 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 border border-gray-200"
              rows={4}
            />
            <div className="flex flex-col space-y-2">
              <button onClick={sendMessage}
                disabled={isRecording || isLoading || (!input.trim() && !file)}
                className="w-20 h-12 px-4 py-3 bg-blue-200 text-gray-800 rounded-xl hover:bg-blue-300 transition-colors disabled:opacity-50">
                {isLoading ? '..⏰..' : 'Send'}
              </button>
              <button onClick={toggleRecording}
                className={`w-20 h-12 px-4 py-3 rounded-xl ${isRecording ? 'bg-red-400 text-white' : 'bg-green-200 text-gray-800'} hover:opacity-90`}>
                <img src="mic-icon.png" alt={isRecording ? 'Stop recording' : 'Start recording'} className="w-6 h-6 mx-auto" />
              </button>
            </div>
          </div>

          {/* File Upload */}
          <div className="flex space-x-3">
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="text-gray-800 bg-gray-50 p-3 rounded-xl cursor-pointer border border-gray-200"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
