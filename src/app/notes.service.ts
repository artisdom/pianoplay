// [PianoPlay](https://michaelecke.com/pianoplay) - Copyright (c) 2021 Rodrigo Jorge Vilar de Linares.

import { Injectable } from '@angular/core';
import { Cursor } from 'opensheetmusicdisplay';

export type NoteObject = {
  value: number;
  key: string;
  timestamp: number;
  staffId: number;
  voice: number;
  fingering: string;
  isGrace: boolean;
};

@Injectable({
  providedIn: 'root',
})
export class NotesService {
  mapPressed: Map<string, number> = new Map();
  // Initialize maps of notes comming from Music Sheet
  mapRequired = new Map<string, NoteObject>();
  mapPrevRequired = new Map<string, NoteObject>();
  tempoInBPM: number;

  constructor() {
    this.tempoInBPM = 120;
  }

  getMapRequired(): Map<string, NoteObject> {
    return this.mapRequired;
  }

  getMapRequiredValue0(): Map<string, NoteObject> {
    const result = new Map<string, NoteObject>();
    for (const [key, noteObj] of this.mapRequired) {
      if (noteObj.value === 0) {
        result.set(key, noteObj);
      }
    }
    return result;
  }

  getMapPrevRequired(): Map<string, NoteObject> {
    return this.mapPrevRequired;
  }

  getMapPressed(): Map<string, number> {
    return this.mapPressed;
  }

  clear(): void {
    this.mapPressed.clear();
    this.mapRequired.clear();
    this.mapPrevRequired.clear();
  }

  press(name: string): void {
    this.mapPressed.set(name, 1);
  }

  release(name: string): void {
    this.mapPressed.delete(name);
  }

  // Check that new notes have been pressed since the last succesful check (value===1)
  private checkRequiredNew(): boolean {
    for (const [, noteObj] of this.mapRequired) {
      if (noteObj.value === 0) {
        if (this.mapPressed.has(noteObj.key)) {
          if ((this.mapPressed.get(noteObj.key) ?? -1) > 1) return false;
        } else {
          return false;
        }
      }
    }
    return true;
  }

  // Check required notes, if successful go to next cursor
  checkRequired(): boolean {
    // Check only new notes, hold notes with pedals would be to difficult
    if (this.checkRequiredNew() === true) {
      // Check that no pressed key is unexpexted (red key)
      for (const [key] of this.mapPressed) if (!this.mapRequired.has(key)) return false;
      // Mark all the notes as no longer new, go to next cycle
      for (const [key, value] of this.mapPressed) this.mapPressed.set(key, value + 1);
      return true;
    }
    return false;
  }

  // Calculate required notes deleting outphased onces and keeping track of new notes
  calculateRequired(cursor: Cursor, upperStave: boolean, lowerStave: boolean, back = false): void {
    // Get current source time stamp
    const timestamp = cursor.iterator.CurrentSourceTimestamp.RealValue;
    // Keep track of previous to avoid red keys before release, increment value
    this.mapPrevRequired.clear();
    for (const [key, noteObj] of this.mapRequired) {
      this.mapPrevRequired.set(key, noteObj);
      this.mapRequired.set(key, { ...noteObj, value: noteObj.value + 1 });
    }
    // Delete expired notes
    for (const [key, value] of this.mapRequired) {
      if (back || timestamp >= value.timestamp) {
        this.mapRequired.delete(key);
      }
    }
    // Register new notes under the cursor
    cursor.VoicesUnderCursor().forEach((voice) => {
      voice.Notes.forEach((value) => {
        this.tempoInBPM = value.SourceMeasure.TempoInBPM;
        if ((value.ParentStaff.Id === 1 && upperStave == true) || (value.ParentStaff.Id === 2 && lowerStave == true)) {
          if (value.isRest() === false) {
            const noteString = value.halfTone.toString();
            const noteTimestamp = timestamp + value.Length.RealValue;
            const fingering = value.Fingering ? value.Fingering.value : '';

            // In case of tie, check that it is a start note
            if (typeof value.NoteTie === 'undefined' || value === value.NoteTie.StartNote) {
              this.mapRequired.set(noteString, {
                value: 0,
                key: noteString,
                timestamp: noteTimestamp,
                staffId: value.ParentStaff.Id,
                voice: voice.ParentVoice.VoiceId,
                fingering: fingering,
                isGrace: value.IsGraceNote,
              });
            } else {
              this.mapRequired.set(noteString, {
                value: 1,
                key: noteString,
                timestamp: noteTimestamp,
                staffId: value.ParentStaff.Id,
                voice: voice.ParentVoice.VoiceId,
                fingering: fingering,
                isGrace: value.IsGraceNote,
              });
            }
          }
        }
      });
    });
  }

  // Update note status for piano keyboard
  // Now always calls midiPress/midiRelease with arrays of notes
  // HomePageComponent will detect BLE and handle batching
  // For USB, the original per-note logic is used
  // For BLE, midiPress/midiRelease will be called with arrays of notes
  // (see HomePageComponent for BLE/USB dispatch)
  autoplayRequired(
    midiPress: (notes: number[], velocities: number[]) => void,
    midiRelease: (notes: number[]) => void
  ): void {
    // Collect notes to release and notes to press
    const notesToRelease: number[] = [];
    for (const [key] of this.mapPressed) {
      if (!this.mapRequired.has(key)) {
        notesToRelease.push(parseInt(key) + 12);
      }
    }
    const notesToPress: number[] = [];
    const velocities: number[] = [];
    for (const [key, value] of this.mapRequired) {
      if (value.value === 0) {
        // If already pressed, release first
        if (this.mapPressed.has(key)) {
          notesToRelease.push(parseInt(key) + 12);
        }
        notesToPress.push(parseInt(key) + 12);
        velocities.push(100); // Default velocity, or customize per note if needed, maximum 127.
      }
    }
    if (notesToRelease.length > 0) {
      midiRelease(notesToRelease);
    }
    if (notesToPress.length > 0) {
      midiPress(notesToPress, velocities);
    }
  }
}
