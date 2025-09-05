import { useEffect, useState, useRef } from 'react';
import Rive from '@rive-app/react-canvas';

import IDLEAnimation from './animations/face/IDLE.riv';
import loadingAnimation from './animations/openmind-logo.riv';

const wsUrl = import.meta.env.VITE_WEBSOCKET_URL || 'ws://localhost:8123';

function Loading() {
  return (
    <div className='h-screen bg-white flex flex-col justify-center items-center'>
      <Rive src={loadingAnimation} />
    </div>
  )
}

function Animation() {
  return (
    <div className='h-screen bg-black flex flex-col justify-center items-center'>
      <Rive src={IDLEAnimation} />
    </div>
  )
}

export function App() {
  const [loaded, setLoaded] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log(`WebSocket connected to ${wsUrl}`);
        };

        ws.onmessage = (event) => {
          console.log('Received message from WebSocket:', event.data);
          setLoaded(true);
        };

        ws.onclose = (event) => {
          console.log('WebSocket connection closed:', event.code, event.reason);
          setLoaded(false);

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

  if (!loaded) {
    return <Loading />
  }

  return (
    <Animation />
  )
}

export default App;
