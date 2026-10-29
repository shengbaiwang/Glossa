import type { ConvertInput } from './convertToEpub';
import type { ConversionWarning, WebArticleSource } from './types';

export interface ConversionWorkerRequest {
  type: 'convert';
  payload: ConvertInput;
}

export interface ConversionWorkerSuccess {
  type: 'success';
  payload: {
    epubBuffer: ArrayBuffer;
    name: string;
    title: string;
    author: string;
    source?: WebArticleSource;
    warnings?: ConversionWarning[];
  };
}

export interface ConversionWorkerError {
  type: 'error';
  payload: {
    message: string;
    code?: string;
  };
}

export type ConversionWorkerResponse = ConversionWorkerSuccess | ConversionWorkerError;
