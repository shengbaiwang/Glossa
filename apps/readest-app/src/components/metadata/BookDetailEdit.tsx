import React from 'react';
import {
  Pencil as MdEdit,
  Trash2 as MdDelete,
  Lock as MdLock,
  LockOpen as MdLockOpen,
  Search as MdOutlineSearch,
} from '@/components/GlossaIcons';

import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAuthors, formatPublisher, formatTitle } from '@/utils/book';
import { useFileSelector } from '@/hooks/useFileSelector';
import { FormField } from './FormField';
import BookCover from '@/components/BookCover';
import { useSettingsStore } from '@/store/settingsStore';

interface BookDetailEditProps {
  book: Book;
  metadata: BookMetadata;
  tags: string[];
  fieldSources: Record<string, string>;
  lockedFields: Record<string, boolean>;
  fieldErrors: Record<string, string>;
  searchLoading: boolean;
  onFieldChange: (field: string, value: string | undefined) => void;
  onToggleFieldLock: (field: string) => void;
  onAutoRetrieve: () => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onCancel: () => void;
  onReset: () => void;
  onSave: () => void;
}

const emptyCoverImageUrl = '_blank';

const BookDetailEdit: React.FC<BookDetailEditProps> = ({
  book,
  metadata,
  tags,
  fieldSources,
  lockedFields,
  fieldErrors,
  searchLoading,
  onFieldChange,
  onToggleFieldLock,
  onAutoRetrieve,
  onLockAll,
  onUnlockAll,
  onCancel,
  onReset,
  onSave,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { selectFiles } = useFileSelector(appService, _);

  const hasLockedFields = Object.values(lockedFields).some((locked) => locked);
  const allFieldsLocked = Object.values(lockedFields).every((locked) => locked);
  const isCoverLocked = lockedFields['coverImageUrl'] || false;
  const coverImageUrl = metadata.coverImageBlobUrl || metadata.coverImageUrl;

  const titleAuthorFields = [
    {
      field: 'title',
      label: _('Title'),
      required: true,
      value: formatTitle(metadata.title),
      placeholder: _('Enter book title'),
    },
    {
      field: 'subtitle',
      label: _('Subtitle'),
      required: false,
      value: formatTitle(metadata.subtitle || ''),
      placeholder: _('Enter book subtitle'),
    },
    {
      field: 'author',
      label: _('Author'),
      required: true,
      value: formatAuthors(metadata.author),
      placeholder: _('Enter author name'),
    },
  ];

  const metadataGridFields = [
    {
      field: 'series',
      label: _('Series'),
      value: metadata.series || '',
      placeholder: _('Enter series name'),
    },
    {
      field: 'seriesIndex',
      label: _('Series Index'),
      isNumber: true,
      value: String(metadata.seriesIndex || ''),
      placeholder: _('Enter series index'),
    },
    {
      field: 'seriesTotal',
      label: _('Total in Series'),
      isNumber: true,
      value: String(metadata.seriesTotal || ''),
      placeholder: _('Enter total books in series'),
    },
    {
      field: 'isbn',
      label: _('ISBN'),
      value: metadata.isbn || '',
      placeholder: '9780123456789',
    },
    {
      field: 'publisher',
      label: _('Publisher'),
      value: formatPublisher(metadata.publisher || ''),
      placeholder: _('Enter publisher'),
    },
    {
      field: 'published',
      label: _('Publication Date'),
      value: metadata.published || '',
      placeholder: _('YYYY or YYYY-MM-DD'),
    },
    {
      field: 'language',
      label: _('Language'),
      value: Array.isArray(metadata.language)
        ? metadata.language.join(', ')
        : metadata.language || '',
      placeholder: 'en, zh, fr',
    },
    {
      field: 'identifier',
      label: _('Identifier'),
      value: metadata.identifier || '',
      placeholder: _('Keep existing source identifier'),
    },
  ];
  const metadataFullwidthFields = [
    {
      field: 'tags',
      label: _('Tags'),
      value: tags.join(', '),
      placeholder: _('Favorites, To Read'),
    },
    {
      field: 'description',
      label: _('Description'),
      type: 'textarea',
      rows: 4,
      value: metadata.description || '',
      placeholder: _('Enter book description'),
    },
  ];

  const handleSelectLocalImage = async () => {
    selectFiles({ type: 'covers', multiple: false }).then(async (result) => {
      if (result.error || result.files.length === 0) return;
      const selectedFile = result.files[0]!;
      if (selectedFile.path && appService) {
        const filePath = selectedFile.path;
        const imageUrl = await appService.getCachedImageUrl(filePath);
        onFieldChange('coverImageFile', filePath);
        onFieldChange('coverImageUrl', imageUrl);
      } else if (selectedFile.file) {
        const coverImageBlobUrl = URL.createObjectURL(selectedFile.file);
        onFieldChange('coverImageBlobUrl', coverImageBlobUrl);
      }
    });
  };

  return (
    <div className='glossa-metadata-editor'>
      <div className='glossa-metadata-scroll'>
        <div className='glossa-metadata-overview'>
          <div className='glossa-metadata-cover'>
            <button
              type='button'
              className='glossa-metadata-cover-preview'
              onClick={handleSelectLocalImage}
              disabled={isCoverLocked}
              aria-label={_('Change cover image')}
            >
              <BookCover
                mode='list'
                showSpine={settings.librarySkeuomorphicCovers}
                book={{
                  ...book,
                  metadata: { ...metadata, coverImageUrl },
                  ...(coverImageUrl ? { coverImageUrl } : {}),
                }}
              />
            </button>
            <div className='glossa-metadata-cover-actions'>
              <button
                type='button'
                onClick={handleSelectLocalImage}
                disabled={isCoverLocked}
                className='glossa-button glossa-metadata-replace'
                title={_('Change cover image')}
              >
                <MdEdit className='h-4 w-4' />
                <span>{_('Replace')}</span>
              </button>
              <button
                type='button'
                onClick={() => {
                  onFieldChange('coverImageUrl', emptyCoverImageUrl);
                  onFieldChange('coverImageFile', undefined);
                  onFieldChange('coverImageBlobUrl', undefined);
                }}
                disabled={isCoverLocked}
                className='glossa-icon-button glossa-metadata-remove'
                title={_('Remove cover image')}
                aria-label={_('Remove cover image')}
              >
                <MdDelete className='h-4 w-4' />
              </button>
              <button
                type='button'
                onClick={() => onToggleFieldLock('coverImageUrl')}
                className='glossa-icon-button'
                title={isCoverLocked ? _('Unlock cover') : _('Lock cover')}
                aria-label={isCoverLocked ? _('Unlock cover') : _('Lock cover')}
                aria-pressed={isCoverLocked}
              >
                {isCoverLocked ? (
                  <MdLock className='h-4 w-4' />
                ) : (
                  <MdLockOpen className='h-4 w-4' />
                )}
              </button>
            </div>
          </div>
          <div className='glossa-metadata-title-fields'>
            {titleAuthorFields.map(({ field, label, required, value, placeholder }) => (
              <FormField
                key={field}
                field={field}
                label={label}
                required={required}
                value={value}
                onFieldChange={onFieldChange}
                fieldSources={fieldSources}
                lockedFields={lockedFields}
                fieldErrors={fieldErrors}
                onToggleFieldLock={onToggleFieldLock}
                placeholder={placeholder}
              />
            ))}
          </div>
        </div>

        {/* Metadata Fields Grid */}
        <div className='glossa-metadata-fields'>
          <div className='glossa-metadata-grid'>
            {metadataGridFields.map(({ field, label, value, isNumber, placeholder }) => (
              <FormField
                key={field}
                field={field}
                label={label}
                value={value}
                isNumber={isNumber}
                onFieldChange={onFieldChange}
                fieldSources={fieldSources}
                lockedFields={lockedFields}
                fieldErrors={fieldErrors}
                onToggleFieldLock={onToggleFieldLock}
                placeholder={placeholder}
              />
            ))}
          </div>

          {metadataFullwidthFields.map(
            ({ field, label, type = 'input', rows, value, placeholder }) => (
              <FormField
                key={field}
                field={field}
                label={label}
                type={type as 'input' | 'textarea'}
                rows={rows}
                value={value}
                onFieldChange={onFieldChange}
                fieldSources={fieldSources}
                lockedFields={lockedFields}
                fieldErrors={fieldErrors}
                onToggleFieldLock={onToggleFieldLock}
                placeholder={placeholder}
              />
            ),
          )}
        </div>

        <div className='glossa-metadata-tools'>
          <button
            type='button'
            onClick={onAutoRetrieve}
            disabled={searchLoading}
            aria-busy={searchLoading}
            className='glossa-button'
            title={_('Auto-Retrieve Metadata')}
          >
            {searchLoading ? (
              <span className='loading loading-spinner h-4 w-4' aria-hidden='true' />
            ) : (
              <MdOutlineSearch className='h-4 w-4' />
            )}
            {_('Auto-Retrieve')}
          </button>
          <div className='glossa-metadata-lock-actions'>
            <button
              type='button'
              onClick={onUnlockAll}
              disabled={!hasLockedFields}
              className='glossa-icon-button'
              title={_('Unlock all fields')}
              aria-label={_('Unlock all fields')}
            >
              <MdLockOpen className='h-4 w-4' />
            </button>
            <button
              type='button'
              onClick={onLockAll}
              disabled={allFieldsLocked}
              className='glossa-icon-button'
              title={_('Lock all fields')}
              aria-label={_('Lock all fields')}
            >
              <MdLock className='h-4 w-4' />
            </button>
          </div>
        </div>
      </div>

      <div className='glossa-metadata-footer'>
        <button type='button' onClick={onReset} className='glossa-button'>
          {_('Reset')}
        </button>
        <div className='glossa-dialog-actions flex'>
          <button type='button' onClick={onCancel} className='glossa-button'>
            {_('Cancel')}
          </button>
          <button
            type='button'
            onClick={onSave}
            disabled={Object.keys(fieldErrors).length > 0}
            className='glossa-button glossa-button-primary'
          >
            {_('Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookDetailEdit;
