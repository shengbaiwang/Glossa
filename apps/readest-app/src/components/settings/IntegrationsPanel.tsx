import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import { ChevronRight as MdChevronRight } from '@/components/GlossaIcons';
import { Cloud as RiCloudLine, Database as RiDatabase2Line } from '@/components/GlossaIcons';
import { RiGoogleLine, RiMicrosoftLine, RiAppleLine } from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useSettingsStore } from '@/store/settingsStore';

import { useFileSyncStore } from '@/store/fileSyncStore';

import { isWebAppPlatform } from '@/services/environment';
import {
  getGoogleClientId,
  getGoogleWebClientId,
} from '@/services/sync/providers/gdrive/buildGoogleDriveProvider';
import { getMicrosoftClientId } from '@/services/sync/providers/onedrive/buildOneDriveProvider';
import { isICloudSupportedPlatform } from '@/services/sync/providers/icloud/buildICloudProvider';
import { resolveICloudDocumentsPath } from '@/services/sync/providers/icloud/buildICloudProvider';

import WebDAVForm from './integrations/WebDAVForm';
import GoogleDriveForm from './integrations/GoogleDriveForm';
import OneDriveForm from './integrations/OneDriveForm';
import ICloudForm from './integrations/ICloudForm';
import S3Form from './integrations/S3Form';
import { persistCloudProviderEnabled } from './integrations/cloudSync';
import { canToggleCloudProvider, getThirdPartyRowStatus } from './integrations/cloudSyncStatus';
import {
  getCloudSyncProviders,
  isReadestCloudEnabled,
  resolveCloudSyncGate,
  settingsKeyForBackend,
  type CloudSyncProviderKind,
} from '@/services/sync/cloudSyncProvider';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';
import { canBackendRun, getReadyFileSyncBackends } from '@/services/sync/file/runLibrarySync';
import SubPageHeader from './SubPageHeader';
import { SectionTitle, SettingLabel, Tips } from './primitives';

type SubPage = 'webdav' | 'gdrive' | 's3' | 'onedrive' | 'icloud' | null;

/**
 * Cloud sync provider settings.
 *
 * Pattern: boxed list of NavigationRows. Each row pushes the panel into an
 * inline sub-page (with breadcrumb back-navigation matching the Dictionaries
 * pattern) — no nested modals.
 *
 * TODO(design-system): Once we extract BoxedList / NavigationRow primitives,
 * this panel and CustomDictionaries should both consume them instead of
 * inlining the chassis.
 */
const IntegrationsPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, requestedSubPage, setRequestedSubPage } = useSettingsStore();

  // Surface a library-wide WebDAV sync that's mid-flight in the row's
  // status line. Keeps the user from feeling like the run was lost
  // when they back out of the WebDAV sub-page or close the dialog.
  const isWebDAVSyncing = useFileSyncStore((s) => s.byKind.webdav?.isSyncing ?? false);
  const isGDriveSyncing = useFileSyncStore((s) => s.byKind.gdrive?.isSyncing ?? false);
  const isS3Syncing = useFileSyncStore((s) => s.byKind.s3?.isSyncing ?? false);
  const isOneDriveSyncing = useFileSyncStore((s) => s.byKind.onedrive?.isSyncing ?? false);
  const webdavLastError = useFileSyncStore((s) => s.lastErrorByKind.webdav);
  const gdriveLastError = useFileSyncStore((s) => s.lastErrorByKind.gdrive);
  const s3LastError = useFileSyncStore((s) => s.lastErrorByKind.s3);
  const onedriveLastError = useFileSyncStore((s) => s.lastErrorByKind.onedrive);
  const isICloudSyncing = useFileSyncStore((s) => s.byKind.icloud?.isSyncing ?? false);
  const icloudLastError = useFileSyncStore((s) => s.lastErrorByKind.icloud);
  // "Configured" for iCloud = the container is reachable (an entitled build
  // with an iCloud session). Probed once; Apple Tauri platforms only.
  const [icloudAvailable, setICloudAvailable] = useState(false);
  useEffect(() => {
    if (!isICloudSupportedPlatform()) return;
    resolveICloudDocumentsPath(settings.icloud?.documentsPath)
      .then((path) => setICloudAvailable(!!path))
      .catch(() => setICloudAvailable(false));
  }, [settings.icloud?.documentsPath]);
  const [subPage, setSubPage] = useState<SubPage>(null);

  // Hydrate the OPDS store from settings so the row's catalog count is
  // accurate on first open. Without this the store starts empty and the
  // count reads zero until the user drills into the OPDS sub-page (where
  // CatalogManager loads it). Loading happens once per mount; the store
  // handles backfilling contentId for legacy entries.

  // Android Back / Esc: when any integrations sub-page (KOSync, WebDAV,
  // Readwise, Hardcover, OPDS, Send-to-Readest) is open, intercept and
  // step back to the integrations list instead of letting <Dialog>'s
  // listener close the whole Settings dialog. The hook registers its
  // sync `native-key-down` listener *after* <Dialog>'s, and
  // `dispatchSync` walks listeners LIFO — so this one claims Back first
  // when enabled and `return true` consumes the event. When subPage is
  // null the hook is disabled and Back falls through to close the dialog
  // as before.
  useKeyDownActions({
    enabled: subPage !== null,
    onCancel: () => setSubPage(null),
  });

  // Deep-link consumption: when a caller (e.g. OPDS browser close handler)
  // sets `requestedSubPage` in the store before opening the dialog, drill
  // straight into that sub-page on mount and clear the request so it doesn't
  // stick to the next open. Recognised values match the SubPage union.
  useEffect(() => {
    if (!requestedSubPage) return;
    if (
      requestedSubPage === 'webdav' ||
      requestedSubPage === 'gdrive' ||
      requestedSubPage === 's3' ||
      requestedSubPage === 'onedrive' ||
      requestedSubPage === 'icloud'
    ) {
      setSubPage(requestedSubPage);
    } else if (requestedSubPage === 'cloudsync') {
      // Back-compat with the brief unified "Cloud Sync" page.
      setSubPage('gdrive');
    }
    setRequestedSubPage(null);
  }, [requestedSubPage, setRequestedSubPage]);

  // Sub-page wrapper matches the list-view's `my-4 w-full` so the
  // SubPageHeader's "Integrations" label lands at the exact same Y position
  // as the list-view's h2 — clicking a row reads as a navigation morph
  // rather than a layout shift.

  if (subPage === 'webdav')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Cloud Sync')}
          currentLabel={_('WebDAV')}
          description={_(
            'Sync your library, reading progress, and highlights with a WebDAV server.',
          )}
          onBack={() => setSubPage(null)}
        />
        <WebDAVForm />
        {settings.webdav?.enabled && (
          <div className='mt-5'>
            <Tips>
              <li>
                {_('{{provider}} keeps a full copy of your books, progress, and annotations.', {
                  provider: _('WebDAV'),
                })}
              </li>
            </Tips>
          </div>
        )}
      </div>
    );
  if (subPage === 'gdrive')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Cloud Sync')}
          currentLabel={_('Google Drive')}
          description={_(
            'Sync your library, reading progress, and highlights with your Google Drive.',
          )}
          onBack={() => setSubPage(null)}
        />
        <GoogleDriveForm />
        {settings.googleDrive?.enabled && (
          <div className='mt-5'>
            <Tips>
              <li>
                {_('{{provider}} keeps a full copy of your books, progress, and annotations.', {
                  provider: _('Google Drive'),
                })}
              </li>
            </Tips>
          </div>
        )}
      </div>
    );
  if (subPage === 's3')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Cloud Sync')}
          currentLabel={_('S3-Compatible Storage')}
          description={_(
            'Sync your library, reading progress, and highlights with an S3-compatible bucket such as Cloudflare R2, AWS S3, or MinIO.',
          )}
          onBack={() => setSubPage(null)}
        />
        <S3Form />
        <div className='mt-5'>
          <Tips>
            {
              <li>
                {_('{{provider}} keeps a full copy of your books, progress, and annotations.', {
                  provider: _('S3-Compatible Storage'),
                })}
              </li>
            }
            {<li>{_('App settings still sync through your Cloud account while signed in.')}</li>}
            {
              <li>
                {_(
                  'Make sure the bucket exists and the credentials have read/write access before connecting.',
                )}
              </li>
            }
            {isWebAppPlatform() && (
              <li>
                {_("In the browser, the bucket must allow this site's origin in its CORS policy.")}
              </li>
            )}
          </Tips>
        </div>
      </div>
    );
  if (subPage === 'onedrive')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Cloud Sync')}
          currentLabel={_('OneDrive')}
          description={_(
            'Sync your library, reading progress, and highlights with your Microsoft OneDrive.',
          )}
          onBack={() => setSubPage(null)}
        />
        <OneDriveForm />
        {settings.onedrive?.enabled && (
          <div className='mt-5'>
            <Tips>
              <li>
                {_('{{provider}} keeps a full copy of your books, progress, and annotations.', {
                  provider: _('OneDrive'),
                })}
              </li>
            </Tips>
          </div>
        )}
      </div>
    );
  if (subPage === 'icloud')
    return (
      <div className='my-4 w-full'>
        <SubPageHeader
          parentLabel={_('Cloud Sync')}
          currentLabel={_('iCloud')}
          description={_(
            'Sync your library, reading progress, and highlights with your iCloud Drive.',
          )}
          onBack={() => setSubPage(null)}
        />
        <ICloudForm />
        {settings.icloud?.enabled && (
          <div className='mt-5'>
            <Tips>
              <li>
                {_('{{provider}} keeps a full copy of your books, progress, and annotations.', {
                  provider: _('iCloud'),
                })}
              </li>
            </Tips>
          </div>
        )}
      </div>
    );
  // Cloud sync providers are independently selectable (#5062): any subset of
  // {Readest Cloud, WebDAV, Google Drive, S3, OneDrive, iCloud} can sync the
  // library at once. A "configured" third-party provider (WebDAV creds / a Drive
  // token) can be switched on inline; an unconfigured one must be opened to
  // connect.
  const providers = getCloudSyncProviders(settings);
  const readestEnabled = isReadestCloudEnabled(settings);
  const cloudGate = resolveCloudSyncGate(settings);
  const enabledBackends = getReadyFileSyncBackends(settings);

  /** Book files have a home when Readest Cloud is on or some backend uploads them. */
  const booksBackedUpBy = (kind: FileSyncBackendKind): boolean =>
    readestEnabled ||
    enabledBackends.some(
      (k) => k !== kind && (settings[settingsKeyForBackend(k)]?.syncBooks ?? false),
    );

  const webdavConfigured = !!(settings.webdav?.serverUrl && settings.webdav?.username);
  const gdriveClientId = isWebAppPlatform() ? getGoogleWebClientId() : getGoogleClientId();
  const gdriveConfigured =
    !!gdriveClientId && settings.googleDrive?.oauthClientId === gdriveClientId;
  const webdavStatus = getThirdPartyRowStatus(_, {
    enabled: !!settings.webdav?.enabled,
    configured: webdavConfigured,
    syncing: isWebDAVSyncing,
    paused: cloudGate.paused,
    lastError: webdavLastError,
    syncBooks: settings.webdav?.syncBooks ?? false,
    booksBackedUpElsewhere: booksBackedUpBy('webdav'),
  });
  const gdriveStatus = getThirdPartyRowStatus(_, {
    enabled: !!settings.googleDrive?.enabled,
    configured: gdriveConfigured,
    syncing: isGDriveSyncing,
    paused: cloudGate.paused,
    lastError: gdriveLastError,
    syncBooks: settings.googleDrive?.syncBooks ?? false,
    booksBackedUpElsewhere: booksBackedUpBy('gdrive'),
    // Web Google Drive with a gone/expired token can't sync until reconnected.
    registrationMissing: !gdriveClientId,
    needsReauth: !gdriveConfigured || !canBackendRun('gdrive'),
  });
  const s3Configured = !!(
    settings.s3?.endpoint &&
    settings.s3?.bucket &&
    settings.s3?.accessKeyId &&
    settings.s3?.secretAccessKey
  );
  const s3Status = getThirdPartyRowStatus(_, {
    enabled: !!settings.s3?.enabled,
    configured: s3Configured,
    syncing: isS3Syncing,
    paused: cloudGate.paused,
    lastError: s3LastError,
    syncBooks: settings.s3?.syncBooks ?? false,
    booksBackedUpElsewhere: booksBackedUpBy('s3'),
  });
  const onedriveConfigured =
    !!getMicrosoftClientId() && settings.onedrive?.oauthClientId === getMicrosoftClientId();
  const onedriveStatus = getThirdPartyRowStatus(_, {
    enabled: !!settings.onedrive?.enabled,
    configured: onedriveConfigured,
    syncing: isOneDriveSyncing,
    paused: cloudGate.paused,
    lastError: onedriveLastError,
    syncBooks: settings.onedrive?.syncBooks ?? false,
    booksBackedUpElsewhere: booksBackedUpBy('onedrive'),
    registrationMissing: !getMicrosoftClientId(),
    needsReauth: !onedriveConfigured || !canBackendRun('onedrive'),
  });
  const icloudStatus = getThirdPartyRowStatus(_, {
    enabled: !!settings.icloud?.enabled,
    configured: icloudAvailable,
    syncing: isICloudSyncing,
    paused: cloudGate.paused,
    lastError: icloudLastError,
    syncBooks: settings.icloud?.syncBooks ?? false,
    booksBackedUpElsewhere: booksBackedUpBy('icloud'),
  });
  const toggleCloudProvider = async (kind: CloudSyncProviderKind, next: boolean) => {
    await persistCloudProviderEnabled(envConfig, kind, next);
  };

  return (
    <div className='my-4 w-full space-y-6'>
      <div className='w-full px-4'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Cloud Sync')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('Sync your library, reading progress, and highlights with Cloud.')}
        </p>
      </div>

      <div className='w-full' data-setting-id='settings.integrations.cloudSync'>
        <SectionTitle className='mb-2'>{_('Cloud Sync')}</SectionTitle>
        <div className='card eink-bordered border-base-200 bg-base-100 overflow-hidden border'>
          <div
            className='divide-base-200 divide-y'
            role='group'
            aria-label={_('Cloud sync providers')}
          >
            {(appService?.isDesktopApp ||
              appService?.isAndroidApp ||
              appService?.isIOSApp ||
              // Web: only when a Web-type GIS client id is configured for this build.
              isWebAppPlatform()) && (
              <CloudProviderRow
                icon={RiGoogleLine}
                title={_('Google Drive')}
                status={gdriveStatus}
                checked={!!settings.googleDrive?.enabled}
                canToggle={canToggleCloudProvider({
                  isPremium: true,
                  isConfigured: gdriveConfigured,
                  isEnabled: !!settings.googleDrive?.enabled,
                })}
                onToggle={(next) => toggleCloudProvider('gdrive', next)}
                onOpen={() => setSubPage('gdrive')}
                toggleLabel={_('Sync with Google Drive')}
              />
            )}
            <CloudProviderRow
              icon={RiCloudLine}
              title={_('WebDAV')}
              status={webdavStatus}
              checked={!!settings.webdav?.enabled}
              canToggle={canToggleCloudProvider({
                isPremium: true,
                isConfigured: webdavConfigured,
                isEnabled: !!settings.webdav?.enabled,
              })}
              onToggle={(next) => toggleCloudProvider('webdav', next)}
              onOpen={() => setSubPage('webdav')}
              toggleLabel={_('Sync with WebDAV')}
            />
            <CloudProviderRow
              icon={RiDatabase2Line}
              title={_('S3 Storage')}
              status={s3Status}
              checked={!!settings.s3?.enabled}
              canToggle={canToggleCloudProvider({
                isPremium: true,
                isConfigured: s3Configured,
                isEnabled: !!settings.s3?.enabled,
              })}
              onToggle={(next) => toggleCloudProvider('s3', next)}
              onOpen={() => setSubPage('s3')}
              toggleLabel={_('Sync with S3')}
            />
            {(appService?.isDesktopApp ||
              appService?.isAndroidApp ||
              appService?.isIOSApp ||
              // Web: only when a Web-type Microsoft client id is configured for this build.
              isWebAppPlatform()) && (
              <CloudProviderRow
                icon={RiMicrosoftLine}
                title={_('OneDrive')}
                status={onedriveStatus}
                checked={!!settings.onedrive?.enabled}
                canToggle={canToggleCloudProvider({
                  isPremium: true,
                  isConfigured: onedriveConfigured,
                  isEnabled: !!settings.onedrive?.enabled,
                })}
                onToggle={(next) => toggleCloudProvider('onedrive', next)}
                onOpen={() => setSubPage('onedrive')}
                toggleLabel={_('Sync with OneDrive')}
              />
            )}
            {(appService?.isIOSApp || appService?.isMacOSApp) && (
              <CloudProviderRow
                icon={RiAppleLine}
                title={_('iCloud')}
                status={icloudStatus}
                checked={!!settings.icloud?.enabled}
                canToggle={canToggleCloudProvider({
                  isPremium: true,
                  isConfigured: icloudAvailable,
                  isEnabled: !!settings.icloud?.enabled,
                })}
                onToggle={(next) => toggleCloudProvider('icloud', next)}
                onOpen={() => setSubPage('icloud')}
                toggleLabel={_('Sync with iCloud')}
              />
            )}
          </div>
        </div>
        {providers.length === 0 && (
          <div className='mt-5'>
            <Tips>
              <li>
                {_(
                  'Library sync is off. Your books, progress, and annotations stay on this device.',
                )}
              </li>
            </Tips>
          </div>
        )}
      </div>
    </div>
  );
};

interface CloudProviderRowProps {
  icon: React.ElementType;
  title: string;
  status: string;
  /** This provider syncs the library. */
  checked: boolean;
  /** Can be toggled inline (configured, and allowed by the plan). */
  canToggle: boolean;
  onToggle: (next: boolean) => void;
  onOpen: () => void;
  /** Accessible label for the checkbox (e.g. "Sync with WebDAV"). */
  toggleLabel: string;
  /** End-aligned tier chip (e.g. "Premium") — uniform column before the checkbox. */
  badge?: string;
}

/**
 * A cloud-sync provider row. Two controls: a trailing checkbox that turns
 * this provider's library sync on or off (several may be on at once) —
 * enabled only when it's already configured — and the row body / chevron
 * that opens its config sub-page (connect, sync options, disconnect).
 */
const CloudProviderRow: React.FC<CloudProviderRowProps> = ({
  icon: Icon,
  title,
  status,
  checked,
  canToggle,
  onToggle,
  onOpen,
  toggleLabel,
  badge,
}) => {
  return (
    <div className='group flex w-full items-center gap-3 px-4 py-3'>
      <button
        type='button'
        onClick={onOpen}
        className={clsx(
          'flex min-w-0 flex-1 items-center gap-3 text-left',
          'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
        )}
      >
        <span
          className={clsx(
            'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full',
            'bg-base-200 text-base-content/70',
            'transition-colors duration-150',
            'group-hover:bg-base-300/70',
          )}
        >
          <Icon className='h-5 w-5' />
        </span>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <SettingLabel>{title}</SettingLabel>
          <span className='text-base-content/65 truncate text-[0.85em]'>{status}</span>
        </div>
      </button>
      {badge && <span className='badge badge-sm badge-ghost shrink-0'>{badge}</span>}
      <input
        type='checkbox'
        className='checkbox checkbox-sm flex-shrink-0'
        checked={checked}
        disabled={!canToggle}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={toggleLabel}
        title={toggleLabel}
      />
      <button
        type='button'
        onClick={onOpen}
        aria-label={title}
        className={clsx(
          'text-base-content/50 hover:text-base-content/80 flex-shrink-0 rounded',
          'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
        )}
      >
        <MdChevronRight className='h-5 w-5' />
      </button>
    </div>
  );
};

/**
 * Sibling of IntegrationRow for settings that are a simple on/off toggle
 * (no sub-page). Keeps the same circular-badge chassis so toggle and
 * navigation rows read as one consistent list.
 */

export default IntegrationsPanel;
