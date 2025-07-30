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
  recommendations: string[];
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

  // Load API URL from .env or use fallback for local development
  const apiUrl = process.env.REACT_APP_FASTAPI_URL || 'http://localhost:5000/api/chat';

  // Initialize Web Speech API with permission handling
  useEffect(() => {
    const setupSpeechRecognition = async () => {
      if ('webkitSpeechRecognition' in window) {
        try {
          // Request microphone permission
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

          recognitionRef.current.onend = () => {
            setIsRecording(false);
          };

          recognitionRef.current.onerror = (event: { error: string }) => {
            setError(`Speech recognition error: ${event.error}`);
            setIsRecording(false);
          };
        } catch (err) {
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

    formData.forEach((value, key) => {
      console.log('FormData:', key + ': ' + value);
    });

    try {
      setIsLoading(true);
      const response = await axios.post<ChatResponse>(apiUrl, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-Session-ID': sessionId,
        },
        timeout: 30000, // Set timeout to 30 seconds
      });

      console.log('Response received:', response.data); // Debug log
      if (!response.data) {
        throw new Error('Invalid response format from server');
      }

      let questionText = '';
      if (response.data.question !== null) {
        questionText = response.data.question || 'No question received.';
      } else if (response.data.diagnosis !== null && response.data.home_remedy !== null) {
        questionText = `Condition: ${response.data.diagnosis.condition}\nProbability: ${response.data.diagnosis.probability * 100}%\nRecommendations:\n ${response.data.diagnosis.recommendations.join('\n    ')}\n\n 🌿 Home Remedy 🌿\n ${response.data.home_remedy}`;
      } else {
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
        console.log('Response error:', errorData); // Debug log
      } else if (axiosError.request) {
        errorMessage = `Network Error: No response received. Timeout: ${axiosError.code === 'ECONNABORTED' ? 'Yes' : 'No'}. Check CORS or server availability.`;
        console.log('Request failed:', axiosError.message, axiosError.code); // Debug log
      } else {
        errorMessage = `Error: ${axiosError.message}`;
        console.log('Request setup error:', axiosError.message); // Debug log
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
        .catch((err) => {
          setError('Microphone access denied. Please allow permissions in your browser settings.');
        });
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
    <div className="min-h-screen bg-off-white flex flex-col items-center justify-center p-4" style={{ backgroundColor: '#F5F5F0' }}>
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col h-[80vh] overflow-hidden border border-black">
        <header className="p-4 border-b border-black">
          <h1 className="text-2xl font-bold text-black">I'm your friendly Pocket Doctor</h1>
        </header>

        <div className="flex-1 p-4 overflow-y-auto space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.isUser ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xl p-6 rounded-xl text-black ${
                  msg.isUser ? 'bg-light-blue' : 'bg-white'
                } animate-fade-in break-words whitespace-pre-wrap shadow-lg border border-black`}
              >
                <p className="text-base leading-relaxed">{msg.text}</p>
                <div className="flex justify-end mt-3">
                  <p className="text-xs opacity-70 text-black">{new Date(msg.timestamp).toLocaleTimeString()}</p>
                </div>
                {msg.isUser && file && msg.text === input && (
                  <p className="text-xs mt-2 italic text-black">Attached: {file.name}</p>
                )}
              </div>
            </div>
          ))}
          {error && (
            <div className="text-red-600 text-center text-sm animate-fade-in p-3 bg-white rounded-lg border border-black">{error}</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 border-t border-black flex flex-col space-y-3">
          <div className="flex items-start space-x-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Tell me about yourself and any problems..."
              className="flex-1 p-4 bg-white text-black rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-light-blue text-base leading-relaxed border border-black"
              rows={4}
              aria-label="Message input"
            />
            <div className="flex flex-col space-y-2">
              <button
                onClick={sendMessage}
                disabled={isRecording || isLoading || (!input.trim() && !file)}
                className="w-20 h-12 px-4 py-3 bg-light-blue text-black rounded-xl hover:bg-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-base border border-black"
                aria-label="Send message"
              >
                {isLoading ? '..⏰..' : 'Send'}
              </button>
              <button
                onClick={toggleRecording}
                className={`w-20 h-12 px-4 py-3 rounded-xl ${
                  isRecording ? 'bg-red-500' : 'bg-light-blue'
                } hover:bg-blue-200 transition-colors border border-black self-end`}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                <img
                  src="mic-icon.png"
                  alt={isRecording ? 'Stop recording' : 'Start recording'}
                  className="w-6 h-6 mx-auto"
                />
              </button>
            </div>
          </div>
          <div className="flex space-x-3">
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileChange}
              ref={fileInputRef}
              className="text-black bg-white p-3 rounded-xl cursor-pointer text-base border border-black"
              aria-label="Upload PDF"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;