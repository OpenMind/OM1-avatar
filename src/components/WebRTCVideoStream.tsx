import { useState, useEffect, useCallback, useRef } from 'react';

const webrtcPlayerBaseUrl = 'https://api-video-webrtc.openmind.org';

// WebRTC Reader Config
interface WebRTCReaderConfig {
  url: string;
  onError: (error: string) => void;
  onTrack: (event: RTCTrackEvent) => void;
}

// WebRTC Reader State
type WebRTCReaderState = 'getting_codecs' | 'running' | 'restarting' | 'failed' | 'closed';

// Offer Data Interface
interface OfferData {
  iceUfrag: string;
  icePwd: string;
  medias: string[];
}

// MediaMTX WebRTC Reader
class MediaMTXWebRTCReader {
  private conf: WebRTCReaderConfig;
  private state: WebRTCReaderState = 'getting_codecs';
  private restartTimeout: NodeJS.Timeout | null = null;
  private pc: RTCPeerConnection | null = null;
  private offerData: OfferData | null = null;
  private sessionUrl: string | null = null;
  private queuedCandidates: RTCIceCandidate[] = [];
  private hasReportedError = false;

  constructor(conf: WebRTCReaderConfig) {
    this.conf = conf;
    this.getNonAdvertisedCodecs();
  }

  close() {
    this.state = 'closed';
    if (this.pc !== null) {
      this.pc.close();
    }
    if (this.restartTimeout !== null) {
      clearTimeout(this.restartTimeout);
    }
  }

  resetErrorFlag() {
    this.hasReportedError = false;
  }

  private static async supportsNonAdvertisedCodec(codec: string, fmtp?: string): Promise<boolean> {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      const mediaType = 'audio';
      let payloadType = '';

      pc.addTransceiver(mediaType, { direction: 'recvonly' });
      pc.createOffer()
        .then((offer) => {
          if (!offer.sdp) {
            throw new Error('SDP not present');
          }
          if (offer.sdp.includes(` ${codec}`)) {
            throw new Error('already present');
          }

          const sections = offer.sdp.split(`m=${mediaType}`);
          const payloadTypes = sections.slice(1)
            .map((s) => s.split('\r\n')[0].split(' ').slice(3))
            .reduce((prev, cur) => [...prev, ...cur], []);
          payloadType = MediaMTXWebRTCReader.reservePayloadType(payloadTypes);

          const lines = sections[1].split('\r\n');
          lines[0] += ` ${payloadType}`;
          lines.splice(lines.length - 1, 0, `a=rtpmap:${payloadType} ${codec}`);
          if (fmtp !== undefined) {
            lines.splice(lines.length - 1, 0, `a=fmtp:${payloadType} ${fmtp}`);
          }
          sections[1] = lines.join('\r\n');
          offer.sdp = sections.join(`m=${mediaType}`);
          return pc.setLocalDescription(offer);
        })
        .then(() => {
          resolve(true);
        })
        .catch(() => {
          resolve(false);
        })
        .finally(() => {
          pc.close();
        });
    });
  }

  private static reservePayloadType(payloadTypes: string[]): string {
    for (let i = 30; i <= 127; i++) {
      if ((i <= 63 || i >= 96) && !payloadTypes.includes(i.toString())) {
        const pl = i.toString();
        payloadTypes.push(pl);
        return pl;
      }
    }
    throw new Error('unable to find a free payload type');
  }

  private static linkToIceServers(links: string | null): RTCIceServer[] {
    if (!links) return [];
    return links.split(', ').map((link) => {
      const m = link.match(/^<(.+?)>; rel="ice-server"(; username="(.*?)"; credential="(.*?)"; credential-type="password")?/i);
      if (!m) return { urls: [] };

      const ret: RTCIceServer = { urls: [m[1]] };
      if (m[3] !== undefined) {
        ret.username = JSON.parse(`"${m[3]}"`);
        ret.credential = JSON.parse(`"${m[4]}"`);
      }
      return ret;
    });
  }

  private static parseOffer(sdp: string): OfferData {
    const ret = { iceUfrag: '', icePwd: '', medias: [] as string[] };
    for (const line of sdp.split('\r\n')) {
      if (line.startsWith('m=')) {
        ret.medias.push(line.slice('m='.length));
      } else if (ret.iceUfrag === '' && line.startsWith('a=ice-ufrag:')) {
        ret.iceUfrag = line.slice('a=ice-ufrag:'.length);
      } else if (ret.icePwd === '' && line.startsWith('a=ice-pwd:')) {
        ret.icePwd = line.slice('a=ice-pwd:'.length);
      }
    }
    return ret;
  }

  private handleError(err: string) {
    if (this.state === 'running') {
      if (this.pc !== null) {
        this.pc.close();
        this.pc = null;
      }
      this.offerData = null;
      if (this.sessionUrl !== null) {
        fetch(this.sessionUrl, { method: 'DELETE' }).catch(() => {});
        this.sessionUrl = null;
      }
      this.queuedCandidates = [];
      this.state = 'closed';

      if (this.conf.onError && !this.hasReportedError) {
        this.conf.onError(err);
        this.hasReportedError = true;
      }
    } else if (this.state === 'getting_codecs') {
      this.state = 'failed';
      if (this.conf.onError && !this.hasReportedError) {
        this.conf.onError(err);
        this.hasReportedError = true;
      }
    }
  }

  private async getNonAdvertisedCodecs() {
    try {
      await Promise.all([
        ['pcma/8000/2'],
        ['multiopus/48000/6', 'channel_mapping=0,4,1,2,3,5;num_streams=4;coupled_streams=2'],
        ['L16/48000/2'],
      ].map(async (c) => {
        return await MediaMTXWebRTCReader.supportsNonAdvertisedCodec(c[0], c[1]);
      }));

      if (this.state !== 'getting_codecs') {
        throw new Error('closed');
      }

      this.state = 'running';
      this.start();
    } catch (err) {
      console.error('[WebRTC] Codec check failed:', err);
      this.handleError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  private async start() {
    try {
      const iceServers = await this.requestICEServers();
      const offer = await this.setupPeerConnection(iceServers);
      const answer = await this.sendOffer(offer);
      await this.setAnswer(answer);
    } catch (err) {
      console.error('[WebRTC] Connection failed:', err);
      this.handleError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  private async requestICEServers(): Promise<RTCIceServer[]> {
    const res = await fetch(this.conf.url, { method: 'OPTIONS' });
    return MediaMTXWebRTCReader.linkToIceServers(res.headers.get('Link'));
  }

  private async setupPeerConnection(iceServers: RTCIceServer[]): Promise<string> {
    if (this.state !== 'running') {
      throw new Error('closed');
    }

    this.pc = new RTCPeerConnection({
      iceServers,
    });

    const direction = 'recvonly';
    this.pc.addTransceiver('video', { direction });
    this.pc.addTransceiver('audio', { direction });

    this.pc.onicecandidate = (evt) => this.onLocalCandidate(evt);
    this.pc.onconnectionstatechange = () => this.onConnectionState();
    this.pc.ontrack = (evt) => this.onTrack(evt);

    const offer = await this.pc.createOffer();
    this.offerData = MediaMTXWebRTCReader.parseOffer(offer.sdp!);
    await this.pc.setLocalDescription(offer);
    return offer.sdp!;
  }

  private async sendOffer(offer: string): Promise<string> {
    if (this.state !== 'running') {
      throw new Error('closed');
    }

    const res = await fetch(this.conf.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: offer,
    });

    switch (res.status) {
      case 201:
        break;
      case 404:
        throw new Error('stream not found');
      case 400:
        const errorData = await res.json();
        throw new Error(errorData.error);
      default:
        throw new Error(`bad status code ${res.status}`);
    }

    this.sessionUrl = new URL(res.headers.get('location')!, this.conf.url).toString();
    return res.text();
  }

  private async setAnswer(answer: string) {
    if (this.state !== 'running') {
      throw new Error('closed');
    }

    await this.pc!.setRemoteDescription(new RTCSessionDescription({
      type: 'answer',
      sdp: answer,
    }));

    if (this.state === 'running' && this.queuedCandidates.length !== 0) {
      this.sendLocalCandidates(this.queuedCandidates);
      this.queuedCandidates = [];
    }
  }

  private onLocalCandidate(evt: RTCPeerConnectionIceEvent) {
    if (this.state !== 'running') return;
    if (evt.candidate !== null) {
      if (this.sessionUrl === null) {
        this.queuedCandidates.push(evt.candidate);
      } else {
        this.sendLocalCandidates([evt.candidate]);
      }
    }
  }

  private sendLocalCandidates(candidates: RTCIceCandidate[]) {
    if (!this.sessionUrl) return;

    fetch(this.sessionUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/trickle-ice-sdpfrag',
        'If-Match': '*',
      },
      body: this.generateSdpFragment(candidates),
    })
      .then((res) => {
        if (res.status === 404) {
          throw new Error('stream not found');
        } else if (res.status !== 204) {
          throw new Error(`bad status code ${res.status}`);
        }
      })
      .catch((err) => {
        this.handleError(err.toString());
      });
  }

  private generateSdpFragment(candidates: RTCIceCandidate[]): string {
    if (!this.offerData) {
      return '';
    }

    const candidatesByMedia: { [key: number]: RTCIceCandidate[] } = {};
    for (const candidate of candidates) {
      const mid = candidate.sdpMLineIndex!;
      if (candidatesByMedia[mid] === undefined) {
        candidatesByMedia[mid] = [];
      }
      candidatesByMedia[mid].push(candidate);
    }

    let frag = `a=ice-ufrag:${this.offerData.iceUfrag}\r\n`
      + `a=ice-pwd:${this.offerData.icePwd}\r\n`;

    let mid = 0;
    for (const media of this.offerData.medias) {
      if (candidatesByMedia[mid] !== undefined) {
        frag += `m=${media}\r\n`
          + `a=mid:${mid}\r\n`;

        for (const candidate of candidatesByMedia[mid]) {
          frag += `a=${candidate.candidate}\r\n`;
        }
      }
      mid++;
    }

    return frag;
  }

  private onConnectionState() {
    if (this.state !== 'running') return;
    if (this.pc!.connectionState === 'failed' || this.pc!.connectionState === 'closed') {
      console.error('[WebRTC] Connection closed:', this.pc!.connectionState);
      this.handleError('peer connection closed');
    }
  }

  private onTrack(evt: RTCTrackEvent) {
    this.hasReportedError = false;
    if (this.conf.onTrack) {
      this.conf.onTrack(evt);
    }
  }
}

interface WebRTCVideoStreamProps {
  apiKey: string;
  apiKeyId: string;
  isPublishing: boolean;
}

export function WebRTCVideoStream({ apiKey, apiKeyId, isPublishing }: WebRTCVideoStreamProps) {
  const [message, setMessage] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<MediaMTXWebRTCReader | null>(null);
  const initializedConnectionRef = useRef<string | null>(null);

  // Set video message
  const setVideoMessage = useCallback((str: string) => {
    setMessage(str);
    if (videoRef.current) {
      videoRef.current.controls = str === '';
    }
  }, []);

  // Build WHEP URL
  const buildWebRTCUrl = useCallback((apiKeyId: string, apiKey: string): string => {
    return `${webrtcPlayerBaseUrl}/portal/${apiKeyId}/whep?api_key=${apiKey}`;
  }, []);

  // Cleanup connection
  const cleanup = useCallback(() => {
    if (readerRef.current) {
      try {
        readerRef.current.close();
      } catch (error) {
        console.warn('Error closing WebRTC reader:', error);
      }
      readerRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setVideoMessage('');
  }, [setVideoMessage]);

  // Start WebRTC connection
  const startWebRTCConnection = useCallback(async () => {
    if (!apiKey || !apiKeyId || !isPublishing) {
      cleanup();
      initializedConnectionRef.current = null;
      return;
    }

    setIsLoading(true);
    setVideoMessage('Loading WebRTC...');

    try {
      // Build URL
      const streamUrl = buildWebRTCUrl(apiKeyId, apiKey);

      // Cleanup previous
      cleanup();

      // Set attributes
      if (videoRef.current) {
        videoRef.current.muted = false;
        videoRef.current.autoplay = true;
        videoRef.current.playsInline = true;
      }

      // Create reader
      readerRef.current = new MediaMTXWebRTCReader({
        url: streamUrl,
        onError: (err: string) => {
          console.error('WebRTC Error:', err);

          // Clean up and trigger reconnection
          if (readerRef.current) {
            readerRef.current.close();
            readerRef.current = null;
          }
          initializedConnectionRef.current = null;

          // Handle 404 as waiting
          if (err.includes('stream not found')) {
            setVideoMessage('Waiting for stream...');
          } else {
            setVideoMessage('Connection lost, reconnecting...');
          }

          // Trigger reconnection after delay
          setTimeout(() => {
            if (apiKey && apiKeyId && isPublishing) {
              startWebRTCConnection();
            }
          }, 3000);
        },
        onTrack: (evt: RTCTrackEvent) => {
          if (videoRef.current && evt.streams && evt.streams[0]) {
            videoRef.current.srcObject = evt.streams[0];
            setVideoMessage('');
            
            // Ensure video is ready and auto-play
            videoRef.current.onloadedmetadata = () => {
              if (videoRef.current) {
                videoRef.current.play().catch((error) => {
                  console.error('[WebRTC] Auto-play failed:', error);
                });
              }
            };
          }
        },
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start WebRTC connection';
      console.error('[WebRTC] Failed to start connection:', error);
      initializedConnectionRef.current = null;
      setVideoMessage(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [apiKey, apiKeyId, isPublishing, buildWebRTCUrl, cleanup, setVideoMessage]);

  // Start connection on props change
  useEffect(() => {
    startWebRTCConnection();
  }, [startWebRTCConnection]);

  // Cleanup on unmount
  useEffect(() => {
    const handleBeforeUnload = () => {
      cleanup();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanup();
    };
  }, [cleanup]);

  return (
    <div className="w-full h-screen relative bg-black">
      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        autoPlay
        playsInline
        controls
        style={{ display: message ? 'none' : 'block' }}
      />

      {/* Message Overlay */}
      {message && (
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          {isLoading ? (
            <div className="text-center space-y-2">
              <div className="w-10 h-10 border-3 border-gray-500 border-t-white rounded-full animate-spin mx-auto"></div>
              <p className="text-white text-sm">Connecting to video stream...</p>
            </div>
          ) : message.includes('reconnecting') ? (
            <div className="text-center space-y-3">
              <div className="w-10 h-10 border-3 border-gray-500 border-t-white rounded-full animate-spin mx-auto"></div>
              <p className="text-white text-sm font-medium">Reconnecting...</p>
              <p className="text-xs text-gray-400">Attempting to restore connection</p>
            </div>
          ) : message.includes('Waiting for stream') ? (
            <div className="text-center space-y-3">
              <div className="w-10 h-10 border-3 border-gray-500 border-t-white rounded-full animate-spin mx-auto"></div>
              <p className="text-white text-sm font-medium">Waiting for Stream</p>
              <p className="text-xs text-gray-400">Publisher is not streaming yet</p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-white text-sm">{message}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
