import { describe, expect, it } from 'vitest';
import { Book } from '@/types/book';
import { md5Fingerprint } from '@/utils/md5';
import {
  collectFolderPaths,
  createFolderPath,
  renameFolder,
  moveToFolder,
  placeFolder,
  removeFolder,
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

describe('library group branches', () => {
  it('supports four levels and rejects a fifth without splitting a branch', () => {
    const paths = ['A', 'A/B', 'A/B/C', 'A/B/C/D', 'Target'];
    expect(createFolderPath(paths, 'A/B', 'Third')).toBe('A/B/Third');
    expect(createFolderPath(paths, 'A/B/C', 'Fourth')).toBe('A/B/C/Fourth');
    expect(() => createFolderPath(paths, 'A/B/C/D', 'Fifth')).toThrow('Up to 4 levels');
    expect(moveToFolder([], paths, [md5Fingerprint('A/B')], 'Target').paths).toContain(
      'Target/B/C/D',
    );
    expect(() => moveToFolder([], paths, [md5Fingerprint('A')], 'Target')).toThrow(
      'Up to 4 levels',
    );
  });

  it('creates unnamed groups and numbers collisions without merging', () => {
    expect(createFolderPath([], '', '')).toBe('Untitled');
    expect(createFolderPath(['Untitled', 'Untitled 2'], '', '  ')).toBe('Untitled 3');
    expect(createFolderPath(['History'], '', 'History')).toBe('History 2');
    const moved = moveToFolder(
      [],
      ['A', 'A/Child', 'Target', 'Target/A'],
      [md5Fingerprint('A')],
      'Target',
    );
    expect(moved.paths).toContain('Target/A 2/Child');
    expect(moved.paths).toContain('Target/A');
  });
  it('keeps empty folders and derives legacy parents without including deleted books', () => {
    expect(
      collectFolderPaths(
        [book('a', '文学/俄国/诗歌'), { ...book('b', 'Deleted'), deletedAt: 2 }],
        ['研究/历史'],
      ),
    ).toEqual(['研究', '研究/历史', '文学', '文学/俄国', '文学/俄国/诗歌']);
  });

  it('creates children within existing groups', () => {
    expect(createFolderPath(['文学'], '文学', '  俄国文学  ')).toBe('文学/俄国文学');
    expect(createFolderPath(['文学', '文学/俄国'], '文学/俄国', '诗歌')).toBe('文学/俄国/诗歌');
    expect(() => createFolderPath([], '不存在', '历史')).toThrow('Folder not found');
  });

  it('rejects reserved and slash-containing names, numbering duplicate creates', () => {
    for (const name of ['.', '..', 'a/b', 'a\\b']) {
      expect(() => createFolderPath([], '', name)).toThrow('Invalid folder name');
    }
    expect(createFolderPath(['文学'], '', '文学')).toBe('文学 2');
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
    expect(moveToFolder(books, paths, [md5Fingerprint('文学')], '研究').paths).toContain(
      '研究/文学/俄国',
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

it('orders whole branches at sibling edges and moves branches to root end', () => {
  const paths = ['A', 'A/Child', 'B', 'C'];
  expect(placeFolder([], paths, 'A', 'B', 'after').paths).toEqual(['B', 'A', 'A/Child', 'C']);
  expect(moveToFolder([], paths, [md5Fingerprint('A')], '').paths).toEqual([
    'B',
    'C',
    'A',
    'A/Child',
  ]);
  expect(placeFolder([], paths, 'C', 'A/Child', 'before').paths).toEqual([
    'A',
    'A/C',
    'A/Child',
    'B',
  ]);
  expect(() => placeFolder([], paths, 'A', 'A/Child', 'after')).toThrow(
    'Cannot move a folder into itself',
  );
});
it('preserves legacy deep structures during rename and promotes deletion at any level', () => {
  const paths = ['A', 'A/B', 'A/B/C', 'A/B/C/D', 'A/B/C/D/E'];
  expect(renameFolder([], paths, 'A', 'Legacy').paths).toContain('Legacy/B/C/D/E');
  const books = [book('one', 'A/B'), book('two', 'A/B/C/D/E')];
  const removed = removeFolder(books, paths, 'A/B');
  expect(removed.books.map((b) => b.groupName)).toEqual(['A', 'A/C/D/E']);
  expect(removed.paths).toEqual(['A', 'A/C', 'A/C/D', 'A/C/D/E']);
});
