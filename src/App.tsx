import { useEffect, useState, useRef } from 'react';
import Rive from '@rive-app/react-canvas';

import ThinkAnimation from './animations/face/Think.riv';
import ConfusedAnimation from './animations/face/Confused.riv';
import CuriousAnimation from './animations/face/Curious.riv';
import ExcitedAnimation from './animations/face/Excited.riv';
import HappyAnimation from './animations/face/Happy.riv';
import SadAnimation from './animations/face/Sad.riv';
import loadingAnimation from './animations/openmind-logo.riv';

const wsUrl = import.meta.env.VITE_WEBSOCKET_URL || 'ws://localhost:8123';

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
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const parseMessage = (message: string): AnimationState => {
    if ( message === 'Confused' || message === 'Curious' || message === 'Excited' || message === 'Happy' || message === 'Sad' || message === 'Think') {
      return message;
    }
    return 'Happy';
  };

  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log(`WebSocket connected to ${wsUrl}`);
          setLoaded(true);
          setCurrentAnimation('Happy');
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
          setCurrentAnimation('Happy');

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

  if (!loaded) {
    return <Loading />
  }

  return renderCurrentAnimation();
}

export default App;
