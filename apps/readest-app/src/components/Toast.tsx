import { CircleCheck, CircleX, Info, TriangleAlert, X } from '@/components/GlossaIcons';
import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { eventDispatcher } from '@/utils/event';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export const Toast = () => {
  const { safeAreaInsets } = useThemeStore();
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<ToastType>('info');
  const [toastTimeout, setToastTimeout] = useState(5000);
  const [messageClass, setMessageClass] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const toastDismissTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastClassMap = {
    info: 'toast-info toast-center toast-middle',
    success: 'toast-success toast-top sm:toast-end toast-center',
    warning: 'toast-warning toast-top sm:toast-end toast-center',
    error: 'toast-error toast-top sm:toast-end toast-center',
  };

  const alertClassMap = {
    info: 'alert-primary border-base-300',
    success: 'alert-success not-eink:from-green-500 not-eink:to-emerald-500',
    warning: 'alert-warning not-eink:from-amber-500 not-eink:to-orange-500',
    error: 'alert-error not-eink:from-red-500 not-eink:to-rose-500',
  };

  const iconMap = {
    info: <Info className='h-5 w-5' />,
    success: <CircleCheck className='h-5 w-5' />,
    warning: <TriangleAlert className='h-5 w-5' />,
    error: <CircleX className='h-5 w-5' />,
  };

  useEffect(() => {
    if (toastMessage) {
      setTimeout(() => {
        setIsVisible(true);
      }, 0);
    }
  }, [toastMessage]);

  useEffect(() => {
    if (toastDismissTimeout.current) clearTimeout(toastDismissTimeout.current);
    if (toastMessage) {
      const timeout = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => setToastMessage(''), 300);
      }, toastTimeout);
      toastDismissTimeout.current = timeout;
      return () => {
        if (timeout) clearTimeout(timeout);
      };
    }
    return;
  }, [toastMessage, toastTimeout]);

  const handleShowToast = async (event: CustomEvent) => {
    const { message, type = 'info', timeout, className = '', callback = null } = event.detail;
    setToastMessage(message);
    setToastType(type);
    if (timeout) setToastTimeout(timeout);
    if (callback && typeof callback === 'function') {
      setTimeout(() => callback(), timeout || 5000);
    }
    setMessageClass(className);
  };

  useEffect(() => {
    eventDispatcher.on('toast', handleShowToast);
    return () => {
      eventDispatcher.off('toast', handleShowToast);
    };
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => setToastMessage(''), 300);
    if (toastDismissTimeout.current) clearTimeout(toastDismissTimeout.current);
  };

  return (
    toastMessage && (
      <div
        data-capture-invalidating-overlay='true'
        className={clsx(
          'toast z-[130] w-auto max-w-screen-sm transition-all duration-300',
          toastClassMap[toastType],
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
        )}
        style={{
          top: toastClassMap[toastType].includes('toast-top')
            ? `${(safeAreaInsets?.top || 0) + 44}px`
            : undefined,
        }}
      >
        <div
          className={clsx(
            'alert flex items-center gap-3 shadow-2xl backdrop-blur-sm',
            'min-h-0 rounded-2xl px-5 py-4',
            'not-eink:bg-gradient-to-r border-0',
            alertClassMap[toastType],
            'eink:bg-base-100 eink:border eink:border-base-content',
            toastType !== 'info' && 'text-white',
          )}
        >
          {/* Icon */}
          <div className='flex-shrink-0'>{iconMap[toastType]}</div>

          {/* Message */}
          <span
            className={clsx(
              'max-h-[50vh] flex-1 overflow-y-auto',
              'font-sans text-base font-medium leading-snug sm:text-sm',
              toastType === 'info'
                ? 'max-w-[60vw] truncate sm:max-w-[80vw]'
                : 'min-w-[60vw] max-w-[80vw] whitespace-normal break-words sm:min-w-40 sm:max-w-80',
              messageClass,
            )}
          >
            {toastMessage.split('\n').map((line, idx) => (
              <React.Fragment key={idx}>
                {line || <>&nbsp;</>}
                {idx < toastMessage.split('\n').length - 1 && <br />}
              </React.Fragment>
            ))}
          </span>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className={clsx(
              'flex-shrink-0 rounded-lg p-1 transition-colors',
              toastType === 'info'
                ? 'hover:bg-base-300 hidden'
                : 'hover:bg-white/20 active:bg-white/30',
            )}
            aria-label='Dismiss'
          >
            <X className='h-4 w-4' />
          </button>
        </div>
      </div>
    )
  );
};
