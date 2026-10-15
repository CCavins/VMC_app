import { detectFormat } from '../scene/characterLoader';
import type { CharacterEntry } from './store';

let uploadCounter = 0;

/** Wrap a user-provided character file as a library entry backed by an object URL. */
export function registerUploadedCharacter(file: File): CharacterEntry {
  const url = URL.createObjectURL(file);
  const format = detectFormat(file.name);
  return {
    id: `upload-${++uploadCounter}-${file.name}`,
    name: file.name.replace(/\.[^.]+$/, ''),
    path: url,
    format,
    description: `Uploaded ${format.toUpperCase()} (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
    uploaded: true,
  };
}
