import type { ReactNode } from 'react';
import MenuItem from '@/components/MenuItem';
import { useEnv } from '@/context/EnvContext';
import { useShortcutConfig } from '@/hooks/useShortcuts';
import { useTranslation } from '@/hooks/useTranslation';
import { isMacPlatform } from '@/services/environment';
import {
  canRunReaderCommand,
  readerCommands,
  readerCommandShortcut,
  runReaderCommand,
  type ReaderCommandId,
} from '@/services/readerCommands';

export default function ReaderCommandItem({
  id,
  bookKey,
  icon,
  label,
  toggled,
  destructive,
  onClose,
  closeBook,
}: {
  id: ReaderCommandId;
  bookKey: string;
  icon: ReactNode;
  label?: string;
  toggled?: boolean;
  destructive?: boolean;
  onClose?: () => void;
  closeBook?: (bookKey: string) => void;
}) {
  const { envConfig } = useEnv();
  const _ = useTranslation();
  const shortcuts = useShortcutConfig();
  return (
    <MenuItem
      label={label ?? _(readerCommands[id].label)}
      Icon={icon}
      shortcut={readerCommandShortcut(id, shortcuts, isMacPlatform())?.join(' / ')}
      toggled={toggled}
      disabled={!canRunReaderCommand(id, bookKey)}
      buttonClass={destructive ? 'glossa-delete-action' : undefined}
      onClick={() => {
        onClose?.();
        runReaderCommand(envConfig, id, bookKey, closeBook);
      }}
    />
  );
}
