import { describe, expect, it } from 'vitest';
import { Book } from '@/types/book';
import { md5Fingerprint } from '@/utils/md5';
import {
  collectFolderPaths,
  createFolderPath,
  renameFolder,
  moveToFolder,
} from '@/app/library/utils/libraryFolders';

const book = (hash: string, groupName = ''): Book => ({
  hash,
  groupName,
  groupId: md5Fingerprint(groupName),
  title: hash,
  author: '',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
});

describe('two-level library folders', () => {
  it('keeps empty folders and derives legacy parents without including deleted books', () => {
    expect(
      collectFolderPaths(
        [book('a', '文学/俄国/诗歌'), { ...book('b', 'Deleted'), deletedAt: 2 }],
        ['研究/历史'],
      ),
    ).toEqual(['研究', '研究/历史', '文学', '文学/俄国', '文学/俄国/诗歌']);
  });

  it('creates named children only within an existing first-level folder', () => {
    expect(createFolderPath(['文学'], '文学', '  俄国文学  ')).toBe('文学/俄国文学');
    expect(() => createFolderPath(['文学', '文学/俄国'], '文学/俄国', '诗歌')).toThrow(
      'Folders support two levels',
    );
    expect(() => createFolderPath([], '不存在', '历史')).toThrow('Folder not found');
  });

  it('rejects blank, reserved, slash-containing and duplicate names', () => {
    for (const name of ['', '  ', '.', '..', 'a/b', 'a\\b']) {
      expect(() => createFolderPath([], '', name)).toThrow('Invalid folder name');
    }
    expect(() => createFolderPath(['文学'], '', '文学')).toThrow(
      'A folder with this name already exists',
    );
    expect(createFolderPath(['文学', '历史'], '文学', '历史')).toBe('文学/历史');
  });

  it('renames a parent and all descendants without mutating books or unrelated folders', () => {
    const books = [book('a', '文学/俄国'), book('b', '文学史')];
    const result = renameFolder(
      books,
      ['文学', '文学/俄国', '文学/日本', '文学史'],
      '文学',
      '小说',
      50,
    );
    expect(result.paths).toEqual(['小说', '小说/俄国', '小说/日本', '文学史']);
    expect(result.books[0]).toMatchObject({
      groupName: '小说/俄国',
      groupId: md5Fingerprint('小说/俄国'),
      updatedAt: 50,
    });
    expect(result.books[1]).toBe(books[1]);
    expect(books[0]?.groupName).toBe('文学/俄国');
    expect(() => renameFolder(books, ['文学', '文学史'], '文学', '文学史')).toThrow(
      'A folder with this name already exists',
    );
  });

  it('moves a book to an empty subfolder and back to the library', () => {
    const books = [book('a', '文学'), book('b')];
    const paths = ['文学', '研究', '研究/历史'];
    const moved = moveToFolder(books, paths, ['a'], '研究/历史', 20);
    expect(moved.books[0]?.groupName).toBe('研究/历史');
    expect(moved.books[1]).toBe(books[1]);
    expect(moveToFolder(moved.books, paths, ['a'], '').books[0]).toMatchObject({
      groupName: '',
      groupId: '',
    });
    expect(() => moveToFolder(books, paths, ['a'], '不存在')).toThrow('Folder not found');
  });

  it('moves whole folders with descendant books and keeps emptied source folders', () => {
    const books = [book('a', '文学/俄国'), book('b', '文学/日本'), book('c', '文学史')];
    const paths = ['文学', '文学/俄国', '文学/日本', '研究', '文学史'];
    const result = moveToFolder(books, paths, [md5Fingerprint('文学/俄国')], '研究');
    expect(result.paths).toContain('文学');
    expect(result.paths).toContain('研究/俄国');
    expect(result.paths).not.toContain('文学/俄国');
    expect(result.books.map((b) => b.groupName)).toEqual(['研究/俄国', '文学/日本', '文学史']);
    expect(() => moveToFolder(books, paths, [md5Fingerprint('文学')], '研究')).toThrow(
      'Folders support two levels',
    );
    expect(() => moveToFolder(books, paths, [md5Fingerprint('文学')], '文学/俄国')).toThrow(
      'Cannot move a folder into itself',
    );
  });

  it('does not flatten a selected descendant book when its folder is selected too', () => {
    const books = [book('a', '文学/俄国')];
    const paths = ['文学', '文学/俄国'];
    const result = moveToFolder(books, paths, [md5Fingerprint('文学'), 'a'], '');
    expect(result.books[0]?.groupName).toBe('文学/俄国');
  });
});
