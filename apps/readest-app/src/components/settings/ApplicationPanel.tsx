import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CircleUserRound,
  Download,
  Database,
  Folder,
  RefreshCw,
  Expand,
} from '@/components/GlossaIcons';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useAppLockStore, type AppLockDialogMode } from '@/store/appLockStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import { tauriHandleSetAlwaysOnTop, tauriHandleToggleFullScreen } from '@/utils/window';
import { requestStoragePermission } from '@/utils/permission';
import { selectDirectory } from '@/utils/bridge';
import {
  getBiometricStatus,
  getBiometryLabelKey,
  isBiometricSupported,
} from '@/services/biometric';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { GLOSSA_DOWNLOAD_URL } from '@/services/constants';
import { setBackupDialogVisible } from '@/app/library/components/BackupWindow';
import { setCacheManagerDialogVisible } from '@/app/library/components/CacheManagerWindow';
import { setMigrateDataDirDialogVisible } from '@/app/library/components/MigrateDataWindow';
import { BoxedList, NavigationRow, SettingsSwitchRow } from './primitives';
import FolderImportSettings from './FolderImportSettings';
import DuplicateBooksPanel from './DuplicateBooksPanel';
import LegacyBookCaches from '../LegacyBookCaches';

const ApplicationPanel: React.FC<{ section: 'General' | 'Data' | 'About' | 'Account' }> = ({
  section,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { settings, setSettingsDialogOpen } = useSettingsStore();
  const { setLibrary } = useLibraryStore();
  const { openDialog } = useAppLockStore();
  const [biometry, setBiometry] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState('');
  const [reviewDuplicates, setReviewDuplicates] = useState(false);
  const restoreDuplicateFocus = useRef(false);
  useEffect(() => {
    if (!reviewDuplicates && restoreDuplicateFocus.current) {
      restoreDuplicateFocus.current = false;
      document.querySelector<HTMLButtonElement>('[data-setting-id="review-duplicates"]')?.focus();
    }
  }, [reviewDuplicates]);

  useEffect(() => {
    if (!settings.pinCodeEnabled || !isBiometricSupported(appService)) return;
    let cancelled = false;
    void getBiometricStatus().then(({ available, biometryType }) => {
      if (!cancelled && available) setBiometry(getBiometryLabelKey(biometryType));
    });
    return () => {
      cancelled = true;
    };
  }, [appService, settings.pinCodeEnabled]);

  const lock = (mode: AppLockDialogMode) => openDialog(mode);
  const openWindow = (show: (visible: boolean) => void) => {
    setSettingsDialogOpen(false);
    show(true);
  };
  const refreshMetadata = async () => {
    if (!appService || refreshing) return;
    setRefreshing(true);
    setProgress(_('Loading library...'));
    try {
      const books = await appService.loadLibraryBooks();
      const active = books.filter((book) => !book.deletedAt);
      let refreshed = 0;
      for (const [index, book] of active.entries()) {
        setProgress(`${index + 1} / ${active.length}`);
        try {
          if (await appService.refreshBookMetadata(book)) refreshed++;
        } catch {
          /* Unavailable book files are skipped. */
        }
      }
      await appService.saveLibraryBooks(books);
      setLibrary(books, true);
      setProgress(_('{{count}} books refreshed', { count: refreshed }));
    } catch {
      setProgress(_('Failed to refresh metadata'));
    } finally {
      setRefreshing(false);
    }
  };
  const saveCover = async () => {
    if (!(await requestStoragePermission())) return;
    const value = settings.savedBookCoverForLockScreen ? '' : 'default';
    if (value) {
      const result = await selectDirectory();
      if (!result.path) return;
      await saveSysSettings(envConfig, 'savedBookCoverForLockScreenPath', result.path);
    }
    await saveSysSettings(envConfig, 'savedBookCoverForLockScreen', value);
  };

  if (section === 'Data' && reviewDuplicates)
    return (
      <DuplicateBooksPanel
        onBack={() => {
          restoreDuplicateFocus.current = true;
          setReviewDuplicates(false);
        }}
      />
    );

  if (section === 'Data')
    return (
      <div className='my-4 space-y-6'>
        {isTauriAppPlatform() && (
          <>
            <BoxedList title={_('Import')}>
              <SettingsSwitchRow
                label={_('Auto Import on File Open')}
                checked={!!settings.autoImportBooksOnOpen}
                onChange={() =>
                  void saveSysSettings(
                    envConfig,
                    'autoImportBooksOnOpen',
                    !settings.autoImportBooksOnOpen,
                  )
                }
              />
            </BoxedList>
            <FolderImportSettings />
          </>
        )}
        <BoxedList title={_('Library Data')}>
          <NavigationRow
            title={_('Review Duplicates')}
            data-setting-id='review-duplicates'
            icon={Database}
            onClick={() => setReviewDuplicates(true)}
          />
          <NavigationRow
            title={_('Backup & Restore')}
            icon={Database}
            onClick={() => openWindow(setBackupDialogVisible)}
          />
          {appService?.canCustomizeRootDir && (
            <NavigationRow
              title={_('Change Data Location')}
              icon={Folder}
              onClick={() => openWindow(setMigrateDataDirDialogVisible)}
            />
          )}
          <NavigationRow
            title={_('Refresh Metadata')}
            icon={RefreshCw}
            disabled={refreshing}
            onClick={() => void refreshMetadata()}
          />
          {appService?.isMobileApp && (
            <NavigationRow
              title={_('Manage Cache')}
              icon={Database}
              onClick={() => openWindow(setCacheManagerDialogVisible)}
            />
          )}
        </BoxedList>
        <BoxedList title={_('Storage cleanup')}>
          <LegacyBookCaches />
        </BoxedList>
        {progress && (
          <p className='glossa-supporting-text' role='status'>
            {progress}
          </p>
        )}
      </div>
    );

  if (section === 'Account')
    return (
      <div className='my-4'>
        <BoxedList>
          <NavigationRow
            title={user ? _('Account') : _('Sign In')}
            status={user?.email}
            icon={CircleUserRound}
            onClick={() => {
              setSettingsDialogOpen(false);
              if (user) navigateToProfile(router);
              else navigateToLogin(router);
            }}
          />
        </BoxedList>
      </div>
    );

  if (section === 'About')
    return (
      <div className='my-4 space-y-6'>
        {appService?.hasUpdater && (
          <BoxedList title={_('Update')} data-setting-id='settings.control.checkUpdates'>
            <SettingsSwitchRow
              label={_('Check Updates on Start')}
              checked={!!settings.autoCheckUpdates}
              onChange={() =>
                void saveSysSettings(envConfig, 'autoCheckUpdates', !settings.autoCheckUpdates)
              }
            />
            <SettingsSwitchRow
              label={_('Nightly Builds')}
              checked={settings.updateChannel === 'nightly'}
              onChange={() =>
                void saveSysSettings(
                  envConfig,
                  'updateChannel',
                  settings.updateChannel === 'nightly' ? 'stable' : 'nightly',
                )
              }
              data-setting-id='settings.control.nightlyChannel'
            />
          </BoxedList>
        )}
      </div>
    );

  return (
    <div className='my-4 space-y-6'>
      {isTauriAppPlatform() && (
        <BoxedList title={_('Startup')}>
          <SettingsSwitchRow
            label={_('Open Last Book on Start')}
            checked={!!settings.openLastBooks}
            onChange={() =>
              void saveSysSettings(envConfig, 'openLastBooks', !settings.openLastBooks)
            }
          />
        </BoxedList>
      )}
      {(appService?.hasWindow || appService?.isMobileApp) && (
        <BoxedList title={_('Window')}>
          {appService?.hasWindow && (
            <>
              <SettingsSwitchRow
                label={_('Open Book in New Window')}
                checked={!!settings.openBookInNewWindow}
                onChange={() =>
                  void saveSysSettings(
                    envConfig,
                    'openBookInNewWindow',
                    !settings.openBookInNewWindow,
                  )
                }
              />
              <SettingsSwitchRow
                label={_('Always on Top')}
                checked={!!settings.alwaysOnTop}
                onChange={() => {
                  const next = !settings.alwaysOnTop;
                  void saveSysSettings(envConfig, 'alwaysOnTop', next);
                  void tauriHandleSetAlwaysOnTop(next);
                }}
              />
              <NavigationRow
                title={_('Fullscreen')}
                icon={Expand}
                onClick={() => {
                  setSettingsDialogOpen(false);
                  void tauriHandleToggleFullScreen();
                }}
              />
            </>
          )}
          {appService?.isMobileApp && (
            <SettingsSwitchRow
              label={_('Always Show Status Bar')}
              checked={!!settings.alwaysShowStatusBar}
              onChange={() =>
                void saveSysSettings(
                  envConfig,
                  'alwaysShowStatusBar',
                  !settings.alwaysShowStatusBar,
                )
              }
            />
          )}
        </BoxedList>
      )}
      <BoxedList title={_('App Lock')}>
        {!settings.pinCodeEnabled ? (
          <NavigationRow title={_('Set PIN…')} onClick={() => lock('set')} />
        ) : (
          <>
            <NavigationRow title={_('Change PIN…')} onClick={() => lock('change')} />
            <NavigationRow title={_('Disable PIN…')} onClick={() => lock('disable')} />
            {appService?.isMobileApp && biometry && (
              <SettingsSwitchRow
                label={_('Unlock with {{biometry}}', { biometry: _(biometry) })}
                checked={!!settings.biometricUnlockEnabled}
                onChange={() =>
                  void saveSysSettings(
                    envConfig,
                    'biometricUnlockEnabled',
                    !settings.biometricUnlockEnabled,
                  )
                }
              />
            )}
          </>
        )}
      </BoxedList>
      {appService?.isAndroidApp && (
        <BoxedList title={_('Lock Screen')}>
          <SettingsSwitchRow
            label={_('Save Book Cover')}
            checked={!!settings.savedBookCoverForLockScreen}
            onChange={() => void saveCover()}
          />
        </BoxedList>
      )}
      <BoxedList>
        {isWebAppPlatform() && (
          <NavigationRow
            title={_('Download Glossa')}
            icon={Download}
            onClick={() => window.open(GLOSSA_DOWNLOAD_URL, '_blank')}
          />
        )}
      </BoxedList>
    </div>
  );
};

export default ApplicationPanel;
