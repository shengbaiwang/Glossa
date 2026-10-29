import { useLibraryStore } from '@/store/libraryStore';
import { moveToFolder } from '../utils/libraryFolders';
import { isLibraryTransferCurrent, useLibraryTransfer } from '../utils/libraryTransfer';
import type { useLibraryFolders } from './useLibraryFolders';

export function useLibraryClipboard(folders: ReturnType<typeof useLibraryFolders>) {
  const clipboard = useLibraryTransfer((state) => state.clipboard);
  const canPaste = (path: string) => {
    if (
      folders.busy ||
      !isLibraryTransferCurrent(clipboard, useLibraryStore.getState().library, folders.paths)
    )
      return false;
    try {
      moveToFolder(useLibraryStore.getState().library, folders.paths, clipboard.selection, path);
      return true;
    } catch {
      return false;
    }
  };
  const paste = async (path: string) => {
    const snapshot = useLibraryTransfer.getState().clipboard;
    if (!snapshot || folders.busy) return false;
    const saved = await folders.moveItems(snapshot, path);
    if (saved && useLibraryTransfer.getState().clipboard === snapshot)
      useLibraryTransfer.setState({ clipboard: undefined });
    return saved;
  };
  return { clipboard, canPaste, paste };
}
