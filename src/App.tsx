import { useEffect, useState, useRef } from 'react';
import Rive from '@rive-app/react-canvas';

import IDLEAnimation from './animations/face/IDLE.riv';
import ThinkAnimation from './animations/face/Think.riv';
import TalkAnimation from './animations/face/Talk.riv';
import loadingAnimation from './animations/openmind-logo.riv';

const wsUrl = import.meta.env.VITE_WEBSOCKET_URL || 'ws://localhost:8123';

function Loading() {
  return (
    <div className='h-screen bg-white flex flex-col justify-center items-center'>
      <Rive src={loadingAnimation} />
    </div>
  )
}

function IDLE() {
  return (
    <div className='h-screen bg-black flex flex-col justify-center items-center'>
      <Rive src={IDLEAnimation} />
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

function Talk() {
  return (
    <div className='h-screen bg-black flex flex-col justify-center items-center'>
      <Rive src={TalkAnimation} />
    </div>
  )
}

type AnimationState = 'IDLE' | 'Think' | 'Talk';

export function App() {
  const [loaded, setLoaded] = useState(false);
  const [currentAnimation, setCurrentAnimation] = useState<AnimationState>('IDLE');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const parseMessage = (message: string): AnimationState => {
    if (message === 'IDLE' || message === 'Think' || message === 'Talk') {
      return message;
    }
    return 'IDLE';
  };

  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log(`WebSocket connected to ${wsUrl}`);
          setLoaded(true);
          setCurrentAnimation('IDLE');
        };

        ws.onmessage = (event) => {
          console.log('Received message from WebSocket:', event.data);
          const newState = parseMessage(event.data);
          console.log('Setting animation state to:', newState);
          setCurrentAnimation(newState);
        };

        ws.onclose = (event) => {
          console.log('WebSocket connection closed:', event.code, event.reason);
          setLoaded(false);
          setCurrentAnimation('IDLE');

          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('Attempting to reconnect...');
            connectWebSocket();
          }, 500);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };

      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);

        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 2000);
      }
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const renderCurrentAnimation = () => {
    switch (currentAnimation) {
      case 'Talk':
        return <Talk />;
      case 'Think':
        return <Think />;
      case 'IDLE':
      default:
        return <IDLE />;
    }
  };

  if (!loaded) {
    return <Loading />
  }

  return renderCurrentAnimation();
}

export default App;
