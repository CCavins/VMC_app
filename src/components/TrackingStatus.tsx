import { useStudio } from '../state/store';

/** Current tracking state reduced to a dot colour + one-line label. */
export function useTrackingStatus() {
  const status = useStudio((s) => s.characterStatus);
  const wsConnected = useStudio((s) => s.wsConnected);
  const bridgeAvailable = useStudio((s) => s.bridgeAvailable);
  const fps = useStudio((s) => s.frameFps);
  const tel = useStudio((s) => s.telemetry);
  const trackingState = useStudio((s) => s.trackingState);
  const receiving = fps > 0 || (tel?.lastPacketAgeMs ?? Infinity) < 1500;
  const label = bridgeAvailable === false ? 'preview - live tracking needs the local app'
    : !wsConnected ? 'bridge offline - run npm run dev'
    : trackingState === 'tracking' ? `tracking - ${fps} fps`
    : trackingState === 'idle' ? (receiving ? 'idle - no person in frame' : 'idle - no VMC data')
    : receiving ? 'data received, waiting for a person' : 'waiting for VMC data';
  const tone: 'good' | 'warn' | 'bad' = bridgeAvailable === false ? 'warn' : !wsConnected ? 'bad' : trackingState === 'tracking' ? 'good' : 'warn';
  return { label, tone, loading: status === 'loading' };
}

/** Status pill rendered either in the sidebar header or floating over the viewport. */
export function TrackingStatus({ variant }: { variant: 'sidebar' | 'viewport' }) {
  const { label, tone, loading } = useTrackingStatus();
  return (
    <div className={variant === 'viewport' ? 'status-overlay' : 'status-bar'}>
      <span className={`dot ${tone}`} />
      <span className="status-label">{label}</span>
      {loading && <span className="loading"> - loading character...</span>}
    </div>
  );
}
