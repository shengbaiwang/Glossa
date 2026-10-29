import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import Spinner from './Spinner';

function ActivatedDialog({
  id,
  visible,
  container,
  onReady,
  children,
}: {
  id: string;
  visible: boolean;
  container: RefObject<HTMLDivElement | null>;
  onReady: () => void;
  children: ReactNode;
}) {
  const delivered = useRef<boolean | null>(null);
  // The loaded dialog registers its legacy listener in a passive effect.
  // Remove the placeholder id before that lookup, then replay the request
  // after the child has registered. Its first open performs the usual work.
  useLayoutEffect(() => {
    container.current?.removeAttribute('id');
    onReady();
  }, [container, onReady]);
  useEffect(() => {
    if (delivered.current === visible) return;
    delivered.current = visible;
    document
      .getElementById(id)
      ?.dispatchEvent(new CustomEvent('setDialogVisibility', { detail: { visible } }));
  }, [id, visible]);
  return children;
}

export default function DeferredDialogWindow({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(false);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  useEffect(() => {
    const element = container.current;
    const handleVisibility = (event: Event) => {
      const next = !!(event as CustomEvent).detail.visible;
      setVisible(next);
      if (next) setRequested(true);
    };
    element?.addEventListener('setDialogVisibility', handleVisibility);
    return () => element?.removeEventListener('setDialogVisibility', handleVisibility);
  }, []);

  return (
    <div ref={container} id={ready ? undefined : id} style={{ display: 'contents' }}>
      {requested && (
        <Suspense fallback={<Spinner loading={visible} />}>
          <ActivatedDialog id={id} visible={visible} container={container} onReady={onReady}>
            {children}
          </ActivatedDialog>
        </Suspense>
      )}
    </div>
  );
}
