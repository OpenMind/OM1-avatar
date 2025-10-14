import { useEffect, useState, useRef } from 'react';
import Rive from '@rive-app/react-canvas';
import { WebRTCVideoStream } from './components/WebRTCVideoStream';
import { getEnvVar } from './utils/env';

import ThinkAnimation from './animations/face/Think.riv';
import ConfusedAnimation from './animations/face/Confused.riv';
import CuriousAnimation from './animations/face/Curious.riv';
import ExcitedAnimation from './animations/face/Excited.riv';
import HappyAnimation from './animations/face/Happy.riv';
import SadAnimation from './animations/face/Sad.riv';
import loadingAnimation from './animations/openmind-logo.riv';
const om1WsUrl = getEnvVar('VITE_OM1_WEBSOCKET_URL', 'ws://localhost:8123');
const apiWsUrl = getEnvVar('VITE_API_WEBSOCKET_URL', 'ws://localhost:6123');
const omApiKey = getEnvVar('VITE_OM_API_KEY');
const omApiKeyId = getEnvVar('VITE_OM_API_KEY_ID');
const publishStatusApiUrl = 'https://api.openmind.org/api/core/teleops/video/publish/status';
const publishStatusCheckInterval = 5000;

function Loading() {
  return (
    <div className='h-screen bg-white flex flex-col justify-center items-center'>
      <Rive src={loadingAnimation} />
    </div>
  )
}

function Think() {
  return (
    <div className='h-screen bg-black flex flex-col justify-center items-center'>
      <Rive src={ThinkAnimation} />
    </div>
  )
}

function Confused() {
  return (
    <div className='h-screen bg-black flex flex-col justify-center items-center'>
      <Rive src={ConfusedAnimation} />
    </div>
  )
}

function Curious() {
  return (
    <div className='h-screen bg-black flex flex-col justify-center items-center'>
      <Rive src={CuriousAnimation} />
    </div>
  )
}

function Excited() {
  return (
    <div className='h-screen bg-black flex flex-col justify-center items-center'>
      <Rive src={ExcitedAnimation} />
    </div>
  )
}

function Happy() {
  return (
    <div className='h-screen bg-black flex flex-col justify-center items-center'>
      <Rive src={HappyAnimation} />
    </div>
  )
}

function Sad() {
  return (
    <div className='h-screen bg-black flex flex-col justify-center items-center'>
      <Rive src={SadAnimation} />
    </div>
  )
}

type AnimationState = 'Confused' | 'Curious' | 'Excited' | 'Happy' | 'Sad' | 'Think';

export function App() {
  const [loaded, setLoaded] = useState(false);
  const [currentAnimation, setCurrentAnimation] = useState<AnimationState>('Happy');
  const [allModes, setAllModes] = useState<string[]>([]);
  const [currentMode, setCurrentMode] = useState<string>('');
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const om1WsRef = useRef<WebSocket | null>(null);
  const apiWsRef = useRef<WebSocket | null>(null);
  const om1ReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const apiReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const apiIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const publishCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPublishingRef = useRef<boolean>(false);

  const parseMessage = (message: string): AnimationState => {
    if ( message === 'Confused' || message === 'Curious' || message === 'Excited' || message === 'Happy' || message === 'Sad' || message === 'Think') {
      return message;
    }
    return 'Happy';
  };

  const sendGetMode = () => {
    if (apiWsRef.current && apiWsRef.current.readyState === WebSocket.OPEN) {
      const requestId = crypto.randomUUID();
      const message = JSON.stringify({ action: "get_mode", request_id: requestId });
      apiWsRef.current.send(message);
      console.log('Sent get_mode to API WebSocket:', message);
    }
  };

  const sendModeSwitch = (mode: string) => {
    if (apiWsRef.current && apiWsRef.current.readyState === WebSocket.OPEN) {
      const requestId = crypto.randomUUID();
      const message = JSON.stringify({
        action: "swicth_mode",
        request_id: requestId,
        parameters: mode
      });
      apiWsRef.current.send(message);
      console.log('Sent mode switch to API WebSocket:', message);
      setShowModeSelector(false);
    }
  };

  const checkPublishStatus = async () => {
    if (!omApiKey) return;

    try {
      const response = await fetch(publishStatusApiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${omApiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const isLive = data.status === 'live';

        if (isLive !== isPublishingRef.current) {
          isPublishingRef.current = isLive;
          setIsPublishing(isLive);
        }
      } else if (isPublishingRef.current) {
        isPublishingRef.current = false;
        setIsPublishing(false);
      }
    } catch {
      if (isPublishingRef.current) {
        isPublishingRef.current = false;
        setIsPublishing(false);
      }
    }
  };

  useEffect(() => {
    const connectOm1WebSocket = () => {
      try {
        const ws = new WebSocket(om1WsUrl);
        om1WsRef.current = ws;

        ws.onopen = () => {
          console.log(`OM1 WebSocket connected to ${om1WsUrl}`);
          setLoaded(true);
          setCurrentAnimation('Happy');
        };

        ws.onmessage = (event) => {
          console.log('Received message from OM1 WebSocket:', event.data);
          const newState = parseMessage(event.data);
          console.log('Setting animation state to:', newState);
          setCurrentAnimation(newState);
        };

        ws.onclose = (event) => {
          console.log('OM1 WebSocket connection closed:', event.code, event.reason);
          setLoaded(false);
          setCurrentAnimation('Happy');

          om1ReconnectTimeoutRef.current = setTimeout(() => {
            console.log('Attempting to reconnect OM1 WebSocket...');
            connectOm1WebSocket();
          }, 500);
        };

        ws.onerror = (error) => {
          console.error('OM1 WebSocket error:', error);
        };

      } catch (error) {
        console.error('Failed to create OM1 WebSocket connection:', error);

        om1ReconnectTimeoutRef.current = setTimeout(() => {
          connectOm1WebSocket();
        }, 2000);
      }
    };

    const connectApiWebSocket = () => {
      try {
        const apiWs = new WebSocket(apiWsUrl);
        apiWsRef.current = apiWs;

        apiWs.onopen = () => {
          console.log(`API WebSocket connected to ${apiWsUrl}`);

          const requestId = crypto.randomUUID();
          const initMessage = JSON.stringify({ action: "get_mode", request_id: requestId });
          apiWs.send(initMessage);
          console.log('Sent initial get_mode to API WebSocket:', initMessage);

          apiIntervalRef.current = setInterval(() => {
            if (apiWs.readyState === WebSocket.OPEN) {
              const requestId = crypto.randomUUID();
              const message = JSON.stringify({ action: "get_mode", request_id: requestId });
              apiWs.send(message);
              console.log('Sent to API WebSocket:', message);
            }
          }, currentMode ? 30000 : 5000);
        };

        apiWs.onmessage = (event) => {
          console.log('Received message from API WebSocket:', event.data);

          try {
            const response = JSON.parse(event.data);

            if (response.code === 0 && response.message && response.message.includes("Successfully switched to mode")) {
              console.log('Mode switch successful, requesting updated mode info');
              sendGetMode();
              return;
            }

            if (response.message) {
              const modeData = JSON.parse(response.message);
              if (modeData.all_modes && Array.isArray(modeData.all_modes)) {
                setAllModes(modeData.all_modes);
              }
              if (modeData.current_mode) {
                setCurrentMode(modeData.current_mode);
              }
              console.log('Updated modes:', {
                current: modeData.current_mode,
                all: modeData.all_modes
              });
            }
          } catch (error) {
            console.error('Error parsing API response:', error);
          }
        };

        apiWs.onclose = (event) => {
          console.log('API WebSocket connection closed:', event.code, event.reason);

          if (apiIntervalRef.current) {
            clearInterval(apiIntervalRef.current);
            apiIntervalRef.current = null;
          }

          apiReconnectTimeoutRef.current = setTimeout(() => {
            console.log('Attempting to reconnect API WebSocket...');
            connectApiWebSocket();
          }, 500);
        };

        apiWs.onerror = (error) => {
          console.error('API WebSocket error:', error);
        };

      } catch (error) {
        console.error('Failed to create API WebSocket connection:', error);

        apiReconnectTimeoutRef.current = setTimeout(() => {
          connectApiWebSocket();
        }, 2000);
      }
    };

    connectOm1WebSocket();
    connectApiWebSocket();

    if (omApiKey) {
      checkPublishStatus();
      publishCheckIntervalRef.current = setInterval(() => {
        checkPublishStatus();
      }, publishStatusCheckInterval);
    }

    return () => {
      if (om1ReconnectTimeoutRef.current) {
        clearTimeout(om1ReconnectTimeoutRef.current);
      }
      if (apiReconnectTimeoutRef.current) {
        clearTimeout(apiReconnectTimeoutRef.current);
      }
      if (apiIntervalRef.current) {
        clearInterval(apiIntervalRef.current);
      }
      if (publishCheckIntervalRef.current) {
        clearInterval(publishCheckIntervalRef.current);
      }
      if (om1WsRef.current) {
        om1WsRef.current.close();
      }
      if (apiWsRef.current) {
        apiWsRef.current.close();
      }
    };
  }, []);

  // Sync isPublishing state to ref
  useEffect(() => {
    isPublishingRef.current = isPublishing;
  }, [isPublishing]);

  // Separate effect to handle interval timing changes based on mode
  useEffect(() => {
    if (apiWsRef.current && apiWsRef.current.readyState === WebSocket.OPEN && apiIntervalRef.current) {
      // Clear existing interval
      clearInterval(apiIntervalRef.current);

      // Set new interval based on current mode
      apiIntervalRef.current = setInterval(() => {
        if (apiWsRef.current && apiWsRef.current.readyState === WebSocket.OPEN) {
          const requestId = crypto.randomUUID();
          const message = JSON.stringify({ action: "get_mode", request_id: requestId });
          apiWsRef.current.send(message);
          console.log('Sent to API WebSocket:', message);
        }
      }, currentMode ? 30000 : 5000); // 5 seconds if no mode, 30 seconds if mode is set
    }
  }, [currentMode]);

  const renderCurrentAnimation = () => {
    switch (currentAnimation) {
      case 'Think':
        return <Think />;
      case 'Confused':
        return <Confused />;
      case 'Curious':
        return <Curious />;
      case 'Excited':
        return <Excited />;
      case 'Happy':
        return <Happy />;
      case 'Sad':
        return <Sad />;
      default:
        return <Happy />;
    }
  };

  const ModeSelector = () => (
    <div className="fixed top-4 right-4 z-50">
      <div className="relative">
        <button
          onClick={() => setShowModeSelector(!showModeSelector)}
          className="bg-gray-800 bg-opacity-80 backdrop-blur-sm border border-gray-800 rounded-lg px-4 py-2 text-green-300 text-sm font-medium hover:bg-opacity-90 transition-all duration-200 shadow-lg"
        >
          <div className="flex items-center justify-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-green-300"/>
            <span>{currentMode ? `${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)} Mode` : 'Loading...'} ▼</span>
          </div>
        </button>

        {showModeSelector && allModes.length > 0 && (
          <div className="absolute top-full right-0 mt-2 bg-gray-800 bg-opacity-90 backdrop-blur-sm border border-gray-800 rounded-lg shadow-xl min-w-48 max-h-60 overflow-y-auto">
            {allModes.map((mode) => (
              <button
                key={mode}
                onClick={() => mode === currentMode ? '' : sendModeSwitch(mode)}
                className="block w-full text-left px-4 py-2 text-sm text-white hover:bg-gray-600 hover:bg-opacity-50 transition-colors duration-150 first:rounded-t-lg last:rounded-b-lg"
              >
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${
                    mode === currentMode ? 'bg-green-300' : 'bg-gray-500'
                  }`}></div>
                  <span className={`${mode === currentMode ? 'text-green-300' : 'text-gray-500'}`}>{mode.charAt(0).toUpperCase() + mode.slice(1)} Mode</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Show WebRTC video player when publishing is active (regardless of loaded state)
  if (isPublishing && omApiKey && omApiKeyId) {
    return (
      <>
        <WebRTCVideoStream
          apiKey={omApiKey}
          apiKeyId={omApiKeyId}
          isPublishing={isPublishing}
        />
        <ModeSelector />
      </>
    );
  }

  // Show loading if OM1 WebSocket not connected
  if (!loaded) {
    return (
      <>
        <ModeSelector />
        <Loading />
      </>
    )
  }

  // Show animations when connected and not publishing
  return (
    <>
      {renderCurrentAnimation()}
      <ModeSelector />
    </>
  );
}

export default App;
