import { useEffect, useState, useRef } from 'react';
import Rive from '@rive-app/react-canvas';
import { WebRTCVideoStream } from './components/WebRTCVideoStream';
import { Subtitles, usePacedSubtitle } from './components/Subtitles';
import { CountdownTimer } from './components/CountdownTimer';
import { SystemStatusHUD } from './components/SystemStatusHUD';
import { ActivityIndicator } from './components/ActivityIndicator';
import { getEnvVar } from './utils/env';
import { CotWindow } from './components/CotWindow';
import {
  isActivityStatus,
  isCotStatus,
  isSystemStatus,
  normalizeActivityStatus,
  normalizeCotStatus,
  normalizeSystemStatus,
  staleStatus,
} from './utils/status';
import type { ActivityStatus, CotStatus, NormalizedStatus, SystemStatus } from './utils/status';

import ThinkAnimation from './animations/face/Think.riv';
import ConfusedAnimation from './animations/face/Confused.riv';
import CuriousAnimation from './animations/face/Curious.riv';
import ExcitedAnimation from './animations/face/Excited.riv';
import HappyAnimation from './animations/face/Happy.riv';
import SadAnimation from './animations/face/Sad.riv';
import loadingAnimation from './animations/openmind-logo.riv';
const apiWsUrl = getEnvVar('VITE_API_WEBSOCKET_URL', 'ws://localhost:6123');
const omApiKey = getEnvVar('VITE_OM_API_KEY');
const omApiKeyId = getEnvVar('VITE_OM_API_KEY_ID');
const publishStatusApiUrl = 'https://api.openmind.com/api/core/teleops/video/publish/status';
const publishStatusCheckInterval = 5000;
const showSystemStatus = ['true', '1'].includes(getEnvVar('VITE_SHOW_SYSTEM_STATUS').toLowerCase());
const systemStatusStaleTimeout = 3000;
const showActivityState = ['true', '1'].includes(getEnvVar('VITE_SHOW_ACTIVITY_STATE').toLowerCase());
const activityStaleTimeout = 5000;

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

const ANIMATION_STATES = [
  'confused',
  'curious',
  'excited',
  'happy',
  'sad',
  'think',
] as const;

type AnimationState = (typeof ANIMATION_STATES)[number];

export function App() {
  // State
  const [loaded, setLoaded] = useState(false);
  const [loadingVisible, setLoadingVisible] = useState(true);
  const loadingGraceRef = useRef<NodeJS.Timeout | null>(null);
  const [currentAnimation, setCurrentAnimation] = useState<AnimationState>('happy');
  const [allModes, setAllModes] = useState<string[]>([]);
  const [currentMode, setCurrentMode] = useState<string>('');
  const [showModeSelector, setShowModeSelector] = useState(false);
  const [debugVisible, setDebugVisible] = useState(false);
  const [nosePresses, setNosePresses] = useState(0);
  const [isPublishing, setIsPublishing] = useState(false);
  const [asrText, setAsrText] = useState<string>('');
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const [systemStatus, setSystemStatus] = useState<NormalizedStatus | null>(null);
  const [systemStatusStale, setSystemStatusStale] = useState(true);
  const [activity, setActivity] = useState<ActivityStatus | null>(null);
  const [activityStale, setActivityStale] = useState(true);
  const [activitySupported, setActivitySupported] = useState(showActivityState);
  const [cot, setCot] = useState<CotStatus | null>(null);
  const [cotStale, setCotStale] = useState(true);
  const [speech, setSpeech] = useState({ text: '', run: 0, cps: 0 });
  const wasSpeakingRef = useRef(false);

  // WebSocket
  const apiWsRef = useRef<WebSocket | null>(null);
  const apiReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Intervals
  const apiIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const publishCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Timeouts
  const asrTextTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownSecondsRef = useRef<number | null>(null);
  const countdownDismissRef = useRef<NodeJS.Timeout | null>(null);
  const systemStatusStaleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activityStaleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cotStaleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Health Check
  const healthCheckRequestIdRef = useRef<string | null>(null);

  // State sync 
  const loadedRef = useRef<boolean>(false);
  const isPublishingRef = useRef<boolean>(false);

  // WebSocket Message Handlers
  // Avatar Face
  const handleAvatarMessage = (face: string) => {
    const normalizedFace = face.toLowerCase() as AnimationState;

    if (ANIMATION_STATES.includes(normalizedFace)) {
      console.log('Avatar face received:', face, '-> Setting animation to:', normalizedFace);
      setCurrentAnimation(normalizedFace);
    } else {
      console.warn('Unknown avatar face:', face, '-> Defaulting to: happy');
      setCurrentAnimation('happy');
    }
  };
  // ASR
  const handleAsrMessage = (text: string) => {
    console.log('ASR subtitle received:', text);
    setAsrText(text);

    if (asrTextTimeoutRef.current) {
      clearTimeout(asrTextTimeoutRef.current);
    }

    asrTextTimeoutRef.current = setTimeout(() => {
      setAsrText('');
    }, 5000);
  };

  const handleSystemStatusMessage = (status: SystemStatus) => {
    setSystemStatus(normalizeSystemStatus(status));
    setSystemStatusStale(false);

    if (systemStatusStaleTimeoutRef.current) {
      clearTimeout(systemStatusStaleTimeoutRef.current);
    }

    systemStatusStaleTimeoutRef.current = setTimeout(() => {
      console.warn(`No system_status for ${systemStatusStaleTimeout}ms, marking subsystems unknown`);
      setSystemStatus((previous) => staleStatus(previous?.ts ?? 0));
      setSystemStatusStale(true);
      systemStatusStaleTimeoutRef.current = null;
    }, systemStatusStaleTimeout);
  };

  const handleActivityStateMessage = (frame: Record<string, unknown>) => {
    setActivity(normalizeActivityStatus(frame));
    setActivityStale(false);
    setActivitySupported(true);

    if (activityStaleTimeoutRef.current) {
      clearTimeout(activityStaleTimeoutRef.current);
    }

    activityStaleTimeoutRef.current = setTimeout(() => {
      console.warn(`No activity_state for ${activityStaleTimeout}ms, clearing activity lamps`);
      setActivityStale(true);
      activityStaleTimeoutRef.current = null;
    }, activityStaleTimeout);
  };

  const handleCotMessage = (frame: Record<string, unknown>) => {
    setCot(normalizeCotStatus(frame));
    setCotStale(false);

    if (cotStaleTimeoutRef.current) {
      clearTimeout(cotStaleTimeoutRef.current);
    }

    cotStaleTimeoutRef.current = setTimeout(() => {
      setCotStale(true);
      cotStaleTimeoutRef.current = null;
    }, activityStaleTimeout);
  };

  // Person Greeting Status Countdown
  const handleCountdownMessage = (value: number) => {
    let targetSeconds: number;
    if (value === 20) {
      targetSeconds = 20;
    } else if (value === 10) {
      targetSeconds = 10;
    } else {
      targetSeconds = 0;
    }
    if (targetSeconds === 0 && (countdownDismissRef.current || countdownSecondsRef.current === null)) {
      return;
    }

    countdownSecondsRef.current = targetSeconds;
    setCountdownSeconds(targetSeconds);

    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }

    if (targetSeconds > 0) {
      if (countdownDismissRef.current) {
        clearTimeout(countdownDismissRef.current);
        countdownDismissRef.current = null;
      }
      countdownIntervalRef.current = setInterval(() => {
        if (countdownSecondsRef.current !== null && countdownSecondsRef.current > 0) {
          countdownSecondsRef.current -= 1;
          setCountdownSeconds(countdownSecondsRef.current);
          if (countdownSecondsRef.current === 0) {
            if (countdownIntervalRef.current) {
              clearInterval(countdownIntervalRef.current);
              countdownIntervalRef.current = null;
            }
            countdownDismissRef.current = setTimeout(() => {
              setCountdownSeconds(null);
              countdownSecondsRef.current = null;
              countdownDismissRef.current = null;
            }, 5000);
          }
        }
      }, 1000);
    } else {
      countdownDismissRef.current = setTimeout(() => {
        setCountdownSeconds(null);
        countdownSecondsRef.current = null;
        countdownDismissRef.current = null;
      }, 5000);
    }
  };

  // Mode
  const handleModeResponse = (message: string) => {
    try {
      const modeData = JSON.parse(message);
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
    } catch (error) {
      console.error('Error parsing mode response:', error);
    }
  };

  const handleModeSwitchSuccess = () => {
    console.log('Mode switch successful');
    sendGetMode();
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
        action: "switch_mode",
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
    const sendHealthCheck = (ws: WebSocket) => {
      if (ws.readyState === WebSocket.OPEN) {
        const avatarRequestId = crypto.randomUUID();
        healthCheckRequestIdRef.current = avatarRequestId;
        const healthCheckRequest = JSON.stringify({
          action: "get_avatar_status",
          request_id: avatarRequestId
        });
        ws.send(healthCheckRequest);
        console.log('Sent avatar health check request:', healthCheckRequest);

        const timeoutId = setTimeout(() => {
          console.error('OM1 health check timeout');
          loadedRef.current = false;
          setLoaded(false);
          healthCheckTimeoutsRef.current.delete(avatarRequestId);
        }, 5000);

        healthCheckTimeoutsRef.current.set(avatarRequestId, timeoutId);
      }
    };

    const connectApiWebSocket = () => {
      try {
        const apiWs = new WebSocket(apiWsUrl);
        apiWsRef.current = apiWs;

        apiWs.onopen = () => {
          console.log(`API WebSocket connected to ${apiWsUrl}`);

          // Send initial avatar health check request
          sendHealthCheck(apiWs);

          // Start periodic checking
          healthCheckIntervalRef.current = setInterval(() => {
            sendHealthCheck(apiWs);
          }, 2000);

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

            // Route message to appropriate handler
            if (response.type === 'avatar' && response.face) {
              handleAvatarMessage(response.face);
              return;
            }

            if (response.type === 'asr' && response.text) {
              handleAsrMessage(response.text);
              return;
            }

            if (response.type === 'person_greeting_status' && typeof response.value === 'number') {
              handleCountdownMessage(response.value);
              return;
            }

            if (response.type === 'activity_state') {
              if (isActivityStatus(response)) {
                handleActivityStateMessage(response);
              } else {
                console.warn('Malformed activity_state frame, ignoring:', response);
              }
              return;
            }

            if (response.type === 'cot') {
              if (isCotStatus(response)) {
                handleCotMessage(response);
              }
              return;
            }

            if (response.type === 'system_status') {
              if (isSystemStatus(response)) {
                handleSystemStatusMessage(response);
              } else {
                console.warn('Malformed system_status frame, ignoring:', response);
              }
              return;
            }

            // Handle avatar health check response. Match against every pending
            // health request, not just the newest one — a reply slower than the
            // 2s send interval would otherwise be ignored, its 5s timeout would
            // fire, and the loading screen would flash in over the face.
            if (response.request_id && healthCheckTimeoutsRef.current.has(response.request_id)) {
              if (response.code === 0 && response.status === 'active') {
                console.log('Avatar health check success:', response);

                // Clear previous timeouts 
                healthCheckTimeoutsRef.current.forEach((timeoutId) => {
                  clearTimeout(timeoutId);
                });
                healthCheckTimeoutsRef.current.clear();

                if (!loadedRef.current) {
                  console.log('OM1 avatar system is active');
                  loadedRef.current = true;
                  setLoaded(true);
                  setCurrentAnimation('happy');
                }
              } else {
                console.warn('Avatar health check failed:', response);

                // If False: clear timeout in this session
                const timeoutId = healthCheckTimeoutsRef.current.get(response.request_id);
                if (timeoutId) {
                  clearTimeout(timeoutId);
                  healthCheckTimeoutsRef.current.delete(response.request_id);
                }

                loadedRef.current = false;
                setLoaded(false);
              }

              healthCheckRequestIdRef.current = null;
              return;
            }

            if (response.code === 0 && response.message && response.message.includes("Successfully switched to mode")) {
              handleModeSwitchSuccess();
              return;
            }

            if (response.message) {
              handleModeResponse(response.message);
            }
          } catch (error) {
            console.error('Error parsing API response:', error);
          }
        };

        apiWs.onclose = (event) => {
          console.log('API WebSocket connection closed:', event.code, event.reason);
          loadedRef.current = false;
          setLoaded(false);
          setCurrentAnimation('happy');

          if (systemStatusStaleTimeoutRef.current) {
            clearTimeout(systemStatusStaleTimeoutRef.current);
            systemStatusStaleTimeoutRef.current = null;
          }
          setSystemStatus(null);
          setSystemStatusStale(true);

          if (activityStaleTimeoutRef.current) {
            clearTimeout(activityStaleTimeoutRef.current);
            activityStaleTimeoutRef.current = null;
          }
          setActivity(null);
          setActivityStale(true);

          if (cotStaleTimeoutRef.current) {
            clearTimeout(cotStaleTimeoutRef.current);
            cotStaleTimeoutRef.current = null;
          }
          setCotStale(true);

          if (apiIntervalRef.current) {
            clearInterval(apiIntervalRef.current);
            apiIntervalRef.current = null;
          }

          if (healthCheckIntervalRef.current) {
            clearInterval(healthCheckIntervalRef.current);
            healthCheckIntervalRef.current = null;
            console.log('Stopped avatar health check');
          }

          // Clear all timeouts when ws is closed
          healthCheckTimeoutsRef.current.forEach((timeoutId) => {
            clearTimeout(timeoutId);
          });
          healthCheckTimeoutsRef.current.clear();

          healthCheckRequestIdRef.current = null;

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

    connectApiWebSocket();

    if (omApiKey) {
      checkPublishStatus();
      publishCheckIntervalRef.current = setInterval(() => {
        checkPublishStatus();
      }, publishStatusCheckInterval);
    }

    return () => {
      if (apiReconnectTimeoutRef.current) {
        clearTimeout(apiReconnectTimeoutRef.current);
      }
      if (asrTextTimeoutRef.current) {
        clearTimeout(asrTextTimeoutRef.current);
      }
      healthCheckTimeoutsRef.current.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      healthCheckTimeoutsRef.current.clear();
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
      if (countdownDismissRef.current) {
        clearTimeout(countdownDismissRef.current);
      }
      if (systemStatusStaleTimeoutRef.current) {
        clearTimeout(systemStatusStaleTimeoutRef.current);
      }
      if (activityStaleTimeoutRef.current) {
        clearTimeout(activityStaleTimeoutRef.current);
      }
      if (cotStaleTimeoutRef.current) {
        clearTimeout(cotStaleTimeoutRef.current);
      }
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
      if (apiIntervalRef.current) {
        clearInterval(apiIntervalRef.current);
      }
      if (publishCheckIntervalRef.current) {
        clearInterval(publishCheckIntervalRef.current);
      }
      if (apiWsRef.current) {
        apiWsRef.current.close();
      }
    };
  }, []);

  // Debounce the white loading screen: a brief health-check blip should not
  // flash it over the black face. Only swap to it when the system has been
  // unhealthy for a sustained stretch; recovery hides it immediately.
  useEffect(() => {
    if (loaded) {
      if (loadingGraceRef.current) {
        clearTimeout(loadingGraceRef.current);
        loadingGraceRef.current = null;
      }
      setLoadingVisible(false);
    } else if (!loadingVisible && !loadingGraceRef.current) {
      loadingGraceRef.current = setTimeout(() => {
        setLoadingVisible(true);
        loadingGraceRef.current = null;
      }, 3000);
    }
    return () => {
      if (loadingGraceRef.current) {
        clearTimeout(loadingGraceRef.current);
        loadingGraceRef.current = null;
      }
    };
  }, [loaded, loadingVisible]);

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
      case 'think':
        return <Think />;
      case 'confused':
        return <Confused />;
      case 'curious':
        return <Curious />;
      case 'excited':
        return <Excited />;
      case 'happy':
        return <Happy />;
      case 'sad':
        return <Sad />;
      default:
        return <Happy />;
    }
  };

  const toggleDebugInterface = () => {
    if (debugVisible) {
      setShowModeSelector(false);
    }
    setDebugVisible(!debugVisible);
    setNosePresses((count) => count + 1);
  };

  // The face's nose: always visible, toggles the debug interface. Built as a
  // plain element (not an inline component) so its DOM survives re-renders and
  // the press transitions actually animate. The ripple/pop spans are keyed by
  // press count so each tap replays their animations.
  const nose = (
    <button
      type="button"
      aria-label={debugVisible ? 'Hide debug interface' : 'Show debug interface'}
      onClick={toggleDebugInterface}
      className="group fixed left-1/2 top-[66%] z-[60] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full"
    >
      {nosePresses > 0 && (
        <span
          key={`ripple-${nosePresses}`}
          className="nose-ripple pointer-events-none absolute h-10 w-10 rounded-full border-2 border-white"
        />
      )}
      <span
        key={`pop-${nosePresses}`}
        className={`${
          nosePresses > 0 ? 'nose-pop' : ''
        } block h-10 w-10 rounded-full border-[3px] border-white bg-transparent transition-all duration-200 ease-out group-active:scale-75 ${
          debugVisible
            ? 'opacity-100 shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_0_20px_rgba(255,255,255,0.6)]'
            : 'opacity-80 shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_0_10px_rgba(255,255,255,0.3)]'
        }`}
      />
    </button>
  );

  // Title shown top-center while the debug interface is open.
  const debugTitle = (
    <div
      className={`fixed top-24 left-1/2 z-50 -translate-x-1/2 pointer-events-none hud-anim ${
        debugVisible ? '' : 'hud-hidden-up'
      }`}
    >
      <div
        className="flex items-center gap-2 rounded-full px-4 py-2"
        style={{
          background: 'linear-gradient(180deg, rgba(28,28,32,0.88), rgba(8,8,12,0.95))',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.55)',
        }}
      >
        <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" />
        <span className="text-[12px] font-semibold uppercase leading-none tracking-[0.22em] text-white/85">
          Debug Mode
        </span>
      </div>
    </div>
  );

  const modeSelector = (
    <div
      className={`fixed top-4 right-4 z-50 hud-anim ${debugVisible ? '' : 'hud-hidden-up'}`}
    >
      <div className="relative">
        <button
          onClick={() => setShowModeSelector(!showModeSelector)}
          className="bg-gray-800 bg-opacity-80 backdrop-blur-sm border border-gray-800 rounded-lg px-4 py-2 text-green-300 text-sm font-medium hover:bg-opacity-90 transition-all duration-200 shadow-lg"
        >
          <div className="flex items-center justify-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-green-300" />
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
                  <div className={`w-2 h-2 rounded-full ${mode === currentMode ? 'bg-green-300' : 'bg-gray-500'
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

  const systemStatusHud = showSystemStatus ? (
    <SystemStatusHUD status={systemStatus} stale={systemStatusStale} visible={debugVisible} />
  ) : null;

  const activityIndicator = activitySupported ? (
    <ActivityIndicator state={activity?.state ?? null} stale={activityStale} />
  ) : null;

  // Live pipeline detail (heard speech, spoken reply) shown as one-line
  // bottom-center subtitles; final ASR utterances fill the gaps. While the
  // robot speaks, the subtitle steps through its sentence in time with speech
  // and always plays the sentence out in full, even past the end of playback.
  const activityDetail =
    !activityStale && activity?.state && activity.state !== 'idle' ? activity.detail ?? '' : '';
  const speakingActive = !activityStale && activity?.state === 'speaking';
  const listeningActive = !activityStale && activity?.state === 'listening';

  const activityTtsCps = activity?.ttsCps ?? 0;

  useEffect(() => {
    const started = speakingActive && !wasSpeakingRef.current;
    wasSpeakingRef.current = speakingActive;
    if (speakingActive && activityDetail) {
      // Lock the measured TTS rate in at utterance start so pacing is stable.
      setSpeech((previous) =>
        started || activityDetail !== previous.text
          ? { text: activityDetail, run: previous.run + 1, cps: activityTtsCps }
          : previous,
      );
    }
  }, [speakingActive, activityDetail, activityTtsCps]);

  const { chunk: pacedSpeech, done: speechDone } = usePacedSubtitle(
    speech.text,
    speech.run,
    speech.cps,
  );
  const subtitleText = listeningActive
    ? activityDetail
    : speakingActive || !speechDone
      ? pacedSpeech
      : activityDetail || asrText;

  const cotWindow = <CotWindow cot={cot} stale={cotStale} visible={debugVisible} />;

  // Show WebRTC video player when publishing is active
  if (isPublishing && omApiKey && omApiKeyId) {
    return (
      <>
        <WebRTCVideoStream
          apiKey={omApiKey}
          apiKeyId={omApiKeyId}
          isPublishing={isPublishing}
        />
        {modeSelector}
        {debugTitle}
        {systemStatusHud}
        {activityIndicator}
        {cotWindow}
        {nose}
        <Subtitles text={subtitleText} />
      </>
    );
  }

  // Show loading if OM1 has been unhealthy past the grace period
  if (!loaded && loadingVisible) {
    return (
      <>
        {modeSelector}
        {debugTitle}
        {systemStatusHud}
        {activityIndicator}
        {cotWindow}
        <Loading />
        {nose}
        <CountdownTimer remainingSeconds={countdownSeconds} />
        <Subtitles text={subtitleText} />
      </>
    )
  }

  // Show animations when connected and not publishing. The black backdrop
  // stays put while the eyes fade out in debug mode, so there is no white
  // flash behind the face during the transition.
  return (
    <>
      <div className="h-screen bg-black">
        <div
          className={`h-full transition-all duration-500 ease-out motion-reduce:transition-none ${
            debugVisible ? 'scale-90 opacity-0' : 'scale-100 opacity-100'
          }`}
        >
          {renderCurrentAnimation()}
        </div>
      </div>
      {modeSelector}
      {debugTitle}
      {systemStatusHud}
      {activityIndicator}
      {cotWindow}
      {nose}
      <CountdownTimer remainingSeconds={countdownSeconds} />
      <Subtitles text={subtitleText} />
    </>
  );
}

export default App;
