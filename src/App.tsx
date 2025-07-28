import React, { useState, useEffect, useRef } from 'react';
import axios, { AxiosError } from 'axios';

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
  recommendations: string[];
}

interface ChatResponse {
  question: string | null;
  diagnosis: Diagnosis | null;
  severity_score: number | null;
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
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load API URL from .env or use fallback for local development
  // Set REACT_APP_FASTAPI_URL in .env (e.g., https://api.symptom-analyzer.com/api/chat for public server)
  const apiUrl = process.env.REACT_APP_FASTAPI_URL || 'http://localhost:5000/api/chat';

  // Initialize Web Speech API
  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
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

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current.onerror = (event: { error: string }) => {
        setError(`Speech recognition error: ${event.error}`);
        setIsRecording(false);
      };
    } else {
      setError('Speech recognition not supported in this browser.');
    }
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
    // Transform messages to match the expected history format
    const historyData = messages.map(msg => ({ isUser: msg.isUser, text: msg.text }));
    console.log('History Data before stringify:', historyData); // Debug log
    formData.append('history', JSON.stringify(historyData));
    if (file) formData.append('file', file);

    // Debug log for payload using forEach (ES5 compatible)
    formData.forEach((value, key) => {
      console.log('FormData:', key + ': ' + value);
    });

    try {
      const response = await axios.post<ChatResponse>(apiUrl, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Validate response
      if (!response.data) {
        throw new Error('Invalid response format from server');
      }

      let questionText = '';
      if (response.data.question !== null) {
        // Case 1: While asking questions
        questionText = response.data.question || 'No question received.';
      } else if (response.data.diagnosis !== null && response.data.severity_score !== null && response.data.home_remedy !== null) {
        // Case 2: When ready with diagnosis
        questionText = `Diagnosis:\n- Condition: ${response.data.diagnosis.condition}\n- Probability: ${response.data.diagnosis.probability * 100}%\n- Recommendations:\n  ${response.data.diagnosis.recommendations.join('\n  ')}\n- Severity Score: ${response.data.severity_score}\n- Home Remedy: ${response.data.home_remedy}`;
      } else {
        // Case 3: If diagnosis is unclear
        questionText = 'Unable to determine the condition conclusively. Please consult a qualified doctor for further evaluation.';
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
        errorMessage = 'Network Error: No response received. Check CORS or server availability.';
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
    if (!recognitionRef.current) return;

    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
      setIsRecording(true);
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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-indigo-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl flex flex-col h-[80vh] overflow-hidden">
        <header className="p-4 border-b border-white/20">
          <h1 className="text-2xl font-bold text-white">I'm your friendly Pocket Doctor</h1>
        </header>

        <div className="flex-1 p-4 overflow-y-auto space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xl p-6 rounded-xl text-white ${
                  msg.isUser ? 'bg-indigo-600' : 'bg-gray-700'
                } animate-fade-in break-words whitespace-pre-wrap shadow-lg`}
              >
                <p className="text-base leading-relaxed">{msg.text}</p>
                <div className="flex justify-end mt-3">
                  <p className="text-xs opacity-70">{new Date(msg.timestamp).toLocaleTimeString()}</p>
                </div>
                {msg.isUser && file && msg.text === input && (
                  <p className="text-xs mt-2 italic text-gray-200">Attached: {file.name}</p>
                )}
              </div>
            </div>
          ))}
          {error && (
            <div className="text-red-400 text-center text-sm animate-fade-in p-3 bg-gray-800 rounded-lg">{error}</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-white/20 flex flex-col space-y-3">
          <div className="flex space-x-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Describe your symptoms..."
              className="flex-1 p-4 bg-gray-800 text-white rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-base leading-relaxed"
              rows={4}
              aria-label="Message input"
            />
            <button
              onClick={sendMessage}
              disabled={isRecording || isLoading || (!input.trim() && !file)}
              className="px-5 py-3 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base"
              aria-label="Send message"
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </div>
          <div className="flex space-x-3 items-center">
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="text-white bg-gray-700 p-3 rounded-xl cursor-pointer text-base"
              aria-label="Upload PDF"
            />
            <button
              onClick={toggleRecording}
              className={`px-5 py-3 rounded-xl ${
                isRecording ? 'bg-red-500 animate-pulse' : 'bg-green-500'
              } text-white transition-colors hover:bg-gray-600 text-base`}
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            >
              {isRecording ? 'Stop' : 'Mic'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;