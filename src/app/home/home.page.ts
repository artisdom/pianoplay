// [PianoPlay](https://michaelecke.com/pianoplay) - Copyright (c) 2021 Rodrigo Jorge Vilar de Linares.

import { ChangeDetectorRef, Component, OnInit, ViewChild } from '@angular/core';
import { IonContent, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Piano } from '@tonejs/piano';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

import { NotesService } from '../notes.service';
import { PianoKeyboardComponent } from '../piano-keyboard/piano-keyboard.component';
import { ShippedScoreSelectorComponent } from './shipped-score-selector.component';

import MIDIAccess = WebMidi.MIDIAccess;
import MIDIConnectionEvent = WebMidi.MIDIConnectionEvent;
import MIDIMessageEvent = WebMidi.MIDIMessageEvent;
import MIDIInput = WebMidi.MIDIInput;
import MIDIOutput = WebMidi.MIDIOutput;

// TypeScript declarations for Web Bluetooth API
// These are not in standard TypeScript DOM lib yet
// @ts-ignore
interface BluetoothDevice extends EventTarget {
  gatt?: BluetoothRemoteGATTServer;
  id: string;
  name?: string;
  watchingAdvertisements: boolean;
  // ...other properties...
}
// @ts-ignore
interface BluetoothRemoteGATTServer {
  device: BluetoothDevice;
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
}
// @ts-ignore
interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
}
// @ts-ignore
interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  uuid: string;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  writeValue(value: BufferSource): Promise<void>;
  addEventListener(type: 'characteristicvaluechanged', listener: (this: this, ev: Event) => any): void;
  value: DataView;
}
// @ts-ignore
interface Navigator {
  bluetooth: {
    requestDevice(options: any): Promise<BluetoothDevice>;
  };
}

type BluetoothServiceUUID = string | number;
type BluetoothCharacteristicUUID = string | number;
// Patch navigator.bluetooth for TypeScript
declare global {
  interface Navigator {
    bluetooth: {
      requestDevice(options: any): Promise<BluetoothDevice>;
    };
  }
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePageComponent implements OnInit {
  @ViewChild(IonContent, { static: false }) content!: IonContent;
  @ViewChild(PianoKeyboardComponent) private pianoKeyboard?: PianoKeyboardComponent;
  openSheetMusicDisplay!: OpenSheetMusicDisplay;

  // Music Sheet GUI
  isMobileLayout = false;
  checkboxStaveUp: boolean = true;
  checkboxStaveDown: boolean = true;
  checkboxAutoplay: boolean = false;
  fileLoadError: boolean = false;
  fileLoaded: boolean = false;
  running: boolean = false;
  checkboxColor: boolean = true;
  checkboxKeyboard: boolean = true;
  inputMeasure = { lower: 0, upper: 0 };
  inputMeasureRange = { lower: 0, upper: 0 };
  repeatValue: number = 0;
  repeatText: string = '0';
  repeatCfg: number = 0;
  zoomValue: number = 1.2;
  zoomText: string = '120%';
  speedValue: number = 1;
  speedText: string = '100%';

  // wakeLock used with Midi Input
  wakeLockObj?: WakeLockSentinel;
  wakeLockTimer?: number;

  // MIDI Devices
  midiAvailable = false;
  midiInputs: MIDIInput[] = [];
  midiOutputs: MIDIOutput[] = [];
  midiDevice = 'none';

  // Initialize maps of notes comming from MIDI Input
  mapNotesAutoPressed = new Map();

  // Play
  timePlayStart: number = 0;
  autoplaySkip: number = 0;
  tempoInBPM: number = 120;

  // Language
  lang: string = 'gb';
  // tonejs/piano
  piano: Piano;

  // BLE MIDI state
  bleMidiDevice: BluetoothDevice | null = null;
  bleMidiServer: BluetoothRemoteGATTServer | null = null;
  bleMidiCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  bleMidiConnected: boolean = false;

  // BLE MIDI write queue
  private bleMidiWriteQueue: Uint8Array[] = [];
  private bleMidiWriting: boolean = false;

  // Toolbar visibility
  showToolbar: boolean = true;

  constructor(
    private notesService: NotesService,
    private changeRef: ChangeDetectorRef,
    public translate: TranslateService,
    private modalCtrl: ModalController
  ) {
    // create the piano and load 1 velocity steps to reduce memory consumption
    this.piano = new Piano({
      velocities: 1,
    });
    //connect it to the speaker output
    this.piano.toDestination();

    this.piano.load();

    //Set english as default
    this.lang = 'gb';
    this.translate.setDefaultLang('gb');
    this.translate.use('gb');
  }

  ngOnInit(): void {
    this.openSheetMusicDisplay = new OpenSheetMusicDisplay('osmdContainer');
    this.openSheetMusicDisplay.setOptions({
      backend: 'svg',
      drawTitle: false,
      coloringMode: this.checkboxColor ? 1 : 0,
      followCursor: true,
      useXMLMeasureNumbers: false,
      cursorsOptions: [
        { type: 1, color: '#33e02f', alpha: 0.8, follow: true },
        { type: 2, color: '#ccc', alpha: 0.8, follow: false },
      ],
    });
    // Adjust zoom for mobile devices
    if (window.innerWidth <= 991) {
      this.isMobileLayout = true;
      this.zoomValue = 1;
      this.zoomText = this.zoomValue * 100 + '%';
      this.openSheetMusicDisplay.zoom = this.zoomValue;
    }
    window.onresize = () => (this.isMobileLayout = window.innerWidth <= 991);
    this.midiSetup();
  }

  // GUI Language
  useLanguage(language: string): void {
    this.lang = language;
    this.translate.use(language);
  }

  // GUI Zoom
  updateZoom(qp: string): void {
    this.zoomValue = parseInt(qp) / 100;
    if (isNaN(this.zoomValue)) this.zoomValue = 1;
    if (this.zoomValue < 0.1) this.zoomValue = 0.1;
    if (this.zoomValue > 2) this.zoomValue = 2;
    this.zoomText = (this.zoomValue * 100).toFixed(0) + '%';
    this.openSheetMusicDisplay.Zoom = this.zoomValue;
    this.openSheetMusicDisplay.render();
  }

  // GUI Play speed
  updateSpeed(qp: string): void {
    this.speedValue = parseInt(qp) / 100;
    if (isNaN(this.speedValue)) this.speedValue = 1;
    if (this.speedValue < 0.1) this.speedValue = 0.1;
    if (this.speedValue > 2) this.speedValue = 2;
    this.speedText = (this.speedValue * 100).toFixed(0) + '%';
  }

  // GUI Repeat
  updateRepeat(qp: string): void {
    this.repeatValue = parseInt(qp);
    if (isNaN(this.repeatValue)) this.repeatValue = 0;
    if (this.repeatValue < 0) this.repeatValue = 0;
    if (this.repeatValue > 100) this.repeatValue = 100;
    this.repeatText = this.repeatValue.toFixed(0);
    this.repeatValue = parseInt(this.repeatText);
  }

  // GUI Lower measure
  updateLowerMeasure(qp: string): void {
    this.inputMeasure.lower = parseInt(qp);
    if (isNaN(this.inputMeasure.lower)) {
      this.inputMeasure.lower = this.inputMeasureRange.lower;
    }
    if (this.inputMeasure.lower < this.inputMeasureRange.lower) {
      this.inputMeasure.lower = this.inputMeasureRange.lower;
    }
    // Pussh upper if required
    if (this.inputMeasure.lower > this.inputMeasure.upper) {
      if (this.inputMeasure.lower > this.inputMeasureRange.upper) {
        this.inputMeasure.lower = this.inputMeasureRange.upper;
      }
      this.inputMeasure.upper = this.inputMeasure.lower;
    }
  }

  // GUI Upper Measure
  updateUpperMeasure(qp: string): void {
    this.inputMeasure.upper = parseInt(qp);
    if (isNaN(this.inputMeasure.upper)) {
      this.inputMeasure.upper = this.inputMeasureRange.upper;
    }
    if (this.inputMeasure.upper > this.inputMeasureRange.upper) {
      this.inputMeasure.upper = this.inputMeasureRange.upper;
    }
    // Push lower if required
    if (this.inputMeasure.upper < this.inputMeasure.lower) {
      if (this.inputMeasure.upper < this.inputMeasureRange.lower) {
        this.inputMeasure.upper = this.inputMeasureRange.lower;
      }
      this.inputMeasure.lower = this.inputMeasure.upper;
    }
  }

  // toggle between blackWhite and Color
  osmdColor(checked: boolean): void {
    this.checkboxColor = checked;
    this.openSheetMusicDisplay.setOptions({
      backend: 'svg',
      drawTitle: false,
      followCursor: true,
      coloringMode: this.checkboxColor ? 1 : 0,
      useXMLMeasureNumbers: false,
      cursorsOptions: [
        { type: 1, color: '#33e02f', alpha: 0.8, follow: true },
        { type: 2, color: '#ccc', alpha: 0.8, follow: false },
      ],
    });
    this.openSheetMusicDisplay.render();
  }

  // Load selected file
  osmdLoadFiles(files: Blob[]): void {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const reader = new FileReader();
      reader.onload = (event: ProgressEvent<FileReader>) => {
        // Load Music Sheet
        this.openSheetMusicDisplay.load(event.target?.result?.toString() ?? '').then(
          () => {
            this.openSheetMusicDisplay.zoom = this.zoomValue;
            this.openSheetMusicDisplay.render();
            this.fileLoaded = true;
            this.fileLoadError = false;
            this.osmdReset();
          },
          () => {
            this.fileLoaded = false;
            this.fileLoadError = true;
          }
        );
      };
      reader.readAsBinaryString(file);
    }
  }

  // Load selected file
  osmdLoadURL(url: string): void {
    // Load Music Sheet
    this.openSheetMusicDisplay.load(url).then(
      () => {
        this.openSheetMusicDisplay.zoom = this.zoomValue;
        this.openSheetMusicDisplay.render();
        this.fileLoaded = true;
        this.fileLoadError = false;
        this.osmdReset();
      },
      () => {
        this.fileLoaded = false;
        this.fileLoadError = true;
      }
    );
  }

  // Move cursor to next note
  osmdCursorMoveNext(index: number): boolean {
    //if (!this.running) return false;
    this.openSheetMusicDisplay.cursors[index].next();
    // Move to first valid measure
    if (this.inputMeasure.lower > this.openSheetMusicDisplay.cursors[index].iterator.CurrentMeasureIndex + 1) {
      return this.osmdCursorMoveNext(index);
    }
    return true;
  }

  // Move cursor to next note
  osmdCursorTempoMoveNext(): void {
    // Required to stop next calls if stop is pressed during play
    if (!this.running) return;
    if (!this.osmdEndReached(1)) this.osmdCursorMoveNext(1);
    let timeout = 0;
    // if ended reached check repeat and stat or stop
    if (this.osmdEndReached(1)) {
      // Caculate time to end of compass
      timeout =
        ((this.openSheetMusicDisplay.cursors[1].iterator.CurrentMeasure.AbsoluteTimestamp.RealValue +
          this.openSheetMusicDisplay.cursors[1].iterator.CurrentMeasure.Duration.RealValue -
          this.openSheetMusicDisplay.cursors[1].iterator.CurrentSourceTimestamp.RealValue) *
          4 *
          60000) /
        this.tempoInBPM /
        this.speedValue;
      setTimeout(() => {
        if (!this.osmdEndReached(0)) this.osmdTextFeedback('&#x1F331;', 0, 40);
        this.openSheetMusicDisplay.cursors[1].hide();
      }, timeout);
    } else {
      // Move to Next
      const it2 = this.openSheetMusicDisplay.cursors[1].iterator.clone();
      it2.moveToNext();
      timeout =
        ((it2.CurrentSourceTimestamp.RealValue -
          this.openSheetMusicDisplay.cursors[1].iterator.CurrentSourceTimestamp.RealValue) *
          4 *
          60000) /
        this.tempoInBPM /
        this.speedValue;
      setTimeout(() => {
        this.osmdCursorTempoMoveNext();
      }, timeout);
    }
    // If auto play, then play notes
    if (this.checkboxAutoplay) {
      // Skip when ties only occured
      if (this.autoplaySkip > 0) {
        this.autoplaySkip--;
      } else this.notesService.autoplayRequired(this.midiPressNote.bind(this), this.midiReleaseNote.bind(this));
    }
  }

  osmdEndReached(cursorId: number): boolean {
    // Check end reached
    let endReached = false;
    if (this.openSheetMusicDisplay.cursors[cursorId].iterator.EndReached) {
      endReached = true;
    } else {
      const it2 = this.openSheetMusicDisplay.cursors[cursorId].iterator.clone();
      it2.moveToNext();
      if (it2.EndReached || this.inputMeasure.upper < it2.CurrentMeasureIndex + 1) {
        endReached = true;
      }
    }
    return endReached;
  }

  // Move cursor to next note
  osmdCursorPlayMoveNext(): void {
    // Required to stop next calls if stop is pressed during play
    if (!this.running) return;
    // if ended reached check repeat and stat or stop
    if (this.osmdEndReached(0)) {
      const timeout =
        ((this.openSheetMusicDisplay.cursors[0].iterator.CurrentMeasure.AbsoluteTimestamp.RealValue +
          this.openSheetMusicDisplay.cursors[0].iterator.CurrentMeasure.Duration.RealValue -
          this.openSheetMusicDisplay.cursors[0].iterator.CurrentSourceTimestamp.RealValue) *
          4 *
          60000) /
        this.tempoInBPM /
        this.speedValue;
      this.openSheetMusicDisplay.cursors[0].hide();
      setTimeout(() => {
        if (this.repeatValue > 0) {
          this.repeatValue--;
          this.repeatText = this.repeatValue.toFixed(0);
          this.osmdCursorStart();
        } else {
          this.osmdCursorStop();
          this.repeatValue = this.repeatCfg;
          this.repeatText = this.repeatValue.toFixed(0);
        }
      }, timeout);
      return;
    }
    // Move to next
    if (!this.osmdCursorMoveNext(0)) return;
    // Calculate notes
    this.notesService.calculateRequired(
      this.openSheetMusicDisplay.cursors[0],
      this.checkboxStaveUp,
      this.checkboxStaveDown
    );

    this.turnOffExpiredLeds();

    // Turn on LED for all newly required notes
    this.turnOnAllRequiredLeds();

    this.tempoInBPM = this.notesService.tempoInBPM;
    // Update keyboard
    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();

    // If ties only move to next ans skip one additional autoplay
    if (this.notesService.checkRequired()) {
      this.autoplaySkip++;
      this.osmdCursorPlayMoveNext();
    }
  }

  // Stop cursor
  osmdCursorStop(): void {
    this.checkboxAutoplay = false;
    this.openSheetMusicDisplay.cursors.forEach((cursor) => {
      cursor.hide();
      cursor.reset();
    });
    this.osmdShowFeedback();
    this.running = false;
    this.notesService.clear();
    for (const [key] of this.mapNotesAutoPressed) {
      this.midiReleaseNote(parseInt(key) + 12);
    }
    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
  }

  // Reset selection on measures and set the cursor to the origin
  osmdReset(): void {
    this.osmdCursorStop();
    this.checkboxStaveUp = true;
    this.checkboxStaveDown = true;
    this.inputMeasure.lower = 1;
    this.inputMeasure.upper = this.openSheetMusicDisplay.Sheet.SourceMeasures.length;
    this.inputMeasureRange.lower = 1;
    this.inputMeasureRange.upper = this.openSheetMusicDisplay.Sheet.SourceMeasures.length;
  }

  // Play
  osmdPlay(): void {
    this.running = true;
    this.autoplaySkip = 0;
    this.osmdResetFeedback();
    this.checkboxAutoplay = true;
    this.repeatCfg = this.repeatValue;
    this.startFlashCount = 0;
    this.osmdCursorStart();
  }

  startFlashCount = 0;
  // Practice
  osmdPractice(): void {
    this.running = true;
    this.autoplaySkip = 0;
    this.osmdResetFeedback();
    this.checkboxAutoplay = false;
    this.repeatCfg = this.repeatValue;
    this.startFlashCount = 4;
    this.osmdCursorStart();
  }

  // Resets the cursor to the first note
  osmdCursorStart(): void {
    this.content.scrollToTop();
    this.openSheetMusicDisplay.cursors.forEach((cursor, index) => {
      if (index != 0) cursor.show();
      cursor.reset();
    });
    // Additional tasks in case of new start, not required in repetition
    if (this.repeatValue == this.repeatCfg) {
      this.notesService.clear();
      // free auto pressed notes
      for (const [key] of this.mapNotesAutoPressed) {
        this.midiReleaseNote(parseInt(key) + 12);
      }
    }

    this.osmdHideFeedback();

    if (this.inputMeasure.lower > this.openSheetMusicDisplay.cursors[0].iterator.CurrentMeasureIndex + 1) {
      if (!this.osmdCursorMoveNext(0)) return;
      this.osmdCursorMoveNext(1);
    }
    // Calculate first notes
    this.notesService.calculateRequired(
      this.openSheetMusicDisplay.cursors[0],
      this.checkboxStaveUp,
      this.checkboxStaveDown,
      true
    );

    // Turn on LED for all newly required notes
    this.turnOnAllRequiredLeds();

    this.tempoInBPM = this.notesService.tempoInBPM;
    // Update keyboard
    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
    this.osmdCursorStart2();
  }

  osmdCursorStart2(): void {
    if (this.startFlashCount > 0) {
      if (this.openSheetMusicDisplay.cursors[0].hidden) this.openSheetMusicDisplay.cursors[0].show();
      else this.openSheetMusicDisplay.cursors[0].hide();
      this.startFlashCount--;
      setTimeout(() => {
        this.osmdCursorStart2();
      }, 1000);
      return;
    }
    this.startFlashCount = 0;
    this.openSheetMusicDisplay.cursors[0].show();
    this.timePlayStart = Date.now();
    // Skip initial rests
    if (this.notesService.checkRequired()) {
      this.autoplaySkip++;
      this.osmdCursorPlayMoveNext();
    }
    // if required play
    if (this.checkboxAutoplay) {
      // Skip when ties only occured
      if (this.autoplaySkip > 0) {
        this.autoplaySkip--;
      } else this.notesService.autoplayRequired(this.midiPressNote.bind(this), this.midiReleaseNote.bind(this));
    }
    const it2 = this.openSheetMusicDisplay.cursors[0].iterator.clone();
    it2.moveToNext();
    const timeout =
      ((it2.CurrentSourceTimestamp.RealValue -
        this.openSheetMusicDisplay.cursors[0].iterator.CurrentSourceTimestamp.RealValue) *
        4 *
        60000) /
      this.tempoInBPM /
      this.speedValue;
    setTimeout(() => {
      this.osmdCursorTempoMoveNext();
    }, timeout);
  }

  // Remove all feedback elements
  osmdResetFeedback(): void {
    let elems = document.getElementsByClassName('feedback');
    // Remove all elements
    while (elems.length > 0) {
      for (let i = 0; i < elems.length; i++) {
        const parent = elems[i].parentNode;
        if (parent) parent.removeChild(elems[i]);
      }
      elems = document.getElementsByClassName('feedback');
    }
  }

  // Hide all feedback elements
  osmdHideFeedback(): void {
    document.querySelectorAll<HTMLElement>('.feedback').forEach(function (el) {
      el.style.visibility = 'hidden';
    });
  }

  // Hide all feedback elements
  osmdShowFeedback(): void {
    document.querySelectorAll<HTMLElement>('.feedback').forEach(function (el) {
      el.style.visibility = 'visible';
    });
  }

  // Present feedback text at cursor location
  osmdTextFeedback(text: string, x: number, y: number): void {
    const id =
      (document.getElementById('cursorImg-0')?.style.top ?? '') +
      x +
      '_' +
      (document.getElementById('cursorImg-0')?.style.left ?? '') +
      y +
      '_' +
      this.repeatValue;
    const feedbackElementId = `feedback-${id}`;
    // find unique id in document
    if (document.getElementById(feedbackElementId)) {
      //const elem: HTMLElement = document.getElementById(feedbackElementId)
      //elem.innerHTML += text;
    } else {
      const elem: HTMLElement = document.createElement('p');
      elem.id = feedbackElementId;
      elem.className = 'feedback r' + this.repeatValue;
      elem.style.position = 'absolute';
      elem.style.zIndex = '-1';
      elem.innerHTML = text;
      const parent = document.getElementById('osmdCanvasPage1');
      if (parent) parent.appendChild(elem);
      elem.style.top = parseInt(document.getElementById('cursorImg-0')?.style.top ?? '') - 40 - y + 'px';
      elem.style.left = parseInt(document.getElementById('cursorImg-0')?.style.left ?? '') + x + 'px';
    }
  }

  // Initialize MIDI
  midiSetup(): void {
    navigator.requestMIDIAccess?.({ sysex: true }).then(this.midiSuccess.bind(this), () => {
      this.midiAvailable = false;
    });
  }

  // Register MIDI Inputs' handlers and outputs
  midiInitDev(access: MIDIAccess): void {
    const iterInputs = access.inputs.values();
    const inputs = [];
    for (let o = iterInputs.next(); !o.done; o = iterInputs.next()) {
      if (!o.value.name?.includes('Midi Through')) inputs.push(o.value);
    }
    this.midiDevice = 'none';

    for (let port = 0; port < inputs.length; port++) {
      this.midiDevice = inputs[port].name + ' (' + inputs[port].manufacturer + ')';
      inputs[port].onmidimessage = (event: MIDIMessageEvent) => {
        const NOTE_ON = 9;
        const NOTE_OFF = 8;
        const cmd = event.data[0] >> 4;
        // const channel = event.data[0] & 0xf;
        let pitch = 0;
        if (event.data.length > 1) pitch = event.data[1];
        let velocity = 0;
        if (event.data.length > 2) velocity = event.data[2];
        if (cmd === NOTE_OFF || (cmd === NOTE_ON && velocity === 0)) {
          this.midiNoteOff(event.timeStamp, pitch);
        } else if (cmd === NOTE_ON) {
          this.midiNoteOn(event.timeStamp, pitch);
        }
      };
    }

    const iterOutputs = access.outputs.values();
    const outputs = [];
    for (let o = iterOutputs.next(); !o.done; o = iterOutputs.next()) {
      if (!o.value.name?.includes('Midi Through')) outputs.push(o.value);
    }

    this.midiInputs = inputs;
    this.midiOutputs = outputs;
    this.changeRef.detectChanges();
  }

  // Initialize MIDI event listeners
  midiSuccess(access: MIDIAccess): void {
    this.midiAvailable = true;

    access.onstatechange = (event: MIDIConnectionEvent) => {
      this.midiInitDev(event.target as MIDIAccess);
    };

    this.midiInitDev(access);
  }

  // Turn on LED of note on Ouput MIDI Device
  TurnOnLedNote(pitch: number): void {
    const iter = this.midiOutputs.values();
    for (let o = iter.next(); !o.done; o = iter.next()) {
      o.value.send([0x90, pitch, 1], window.performance.now());
    }
  }

  // Turn off LED of note on Ouput MIDI Device
  TurnOffLedNote(pitch: number): void {
    const iter = this.midiOutputs.values();
    for (let o = iter.next(); !o.done; o = iter.next()) {
      o.value.send([0x80, pitch, 0x00], window.performance.now());
    }
  }

  // Shared function to turn on LED for all newly required notes
  private turnOnAllRequiredLeds(): void {
    if (this.bleMidiConnected) {
      // Collect all required notes and send as a single BLE message
      const keys = Array.from(this.notesService.getMapRequired().keys()).map(([key]) => parseInt(key) + 12);
      if (keys.length > 0) {
        const midiData: number[] = [0x90];

        // Each note-on: [note, 1]
        for (const note of keys) {
          midiData.push(note, 1);
        }
        this.sendMidiBle(midiData);
      }
    } else { // Turn on all required notes via USB MIDI connection
      for (const [key] of this.notesService.getMapRequiredValue0()) {
        this.TurnOnLedNote(parseInt(key) + 12);
      }
    }
  }

  // Shared function to turn off all required LEDs
  private turnOffAllRequiredLeds(): void {
    if (this.bleMidiConnected) {
      // Collect all required notes and send as a single BLE message
      const keys = Array.from(this.notesService.getMapRequiredValue0()).map(([key]) => parseInt(key) + 12);
      if (keys.length > 0) {
        const midiData: number[] = [0x80];

        // Each note-on: [note, 0]
        for (const note of keys) {
          midiData.push(note, 0x00);
        }

        this.sendMidiBle(midiData);
      }
    } else {
      for (const [key] of this.notesService.getMapRequiredValue0()) {
        this.TurnOffLedNote(parseInt(key) + 12);
      }
    }
  }

  // Shared function to turn off LEDs for notes that are no longer required
  private turnOffExpiredLeds(): void {
    if (this.bleMidiConnected) {
      // Collect all expired notes and send as a single BLE message
      const expiredKeys = Array.from(this.notesService.getMapPrevRequired())
        .filter(([key]) => !this.notesService.getMapRequired().has(key))
        .map(([key]) => parseInt(key) + 12);

      if (expiredKeys.length > 0) {
        const midiData: number[] = [0x80];

        // Each note-off: [note, 0x00]
        for (const note of expiredKeys) {
          midiData.push(note, 0x00);
        }

        this.sendMidiBle(midiData);
      }
    } else { // Turn off all expired notes via USB MIDI connection
      for (const [key] of this.notesService.getMapPrevRequired()) {
        if (!this.notesService.getMapRequired().has(key)) {
          this.TurnOffLedNote(parseInt(key) + 12);
        }
      }
    }
  }

  // Press note on Ouput MIDI Device
  midiPressNote(pitch: number, velocity: number): void {
    this.mapNotesAutoPressed.set((pitch - 12).toFixed(), 1);
    if (this.bleMidiConnected) {
      this.sendMidiBle([0x90, pitch, velocity]);
      setTimeout(() => {
        this.midiNoteOn(Date.now() - this.timePlayStart, pitch);
      }, 0);
      return;
    }
    const iter = this.midiOutputs.values();
    for (let o = iter.next(); !o.done; o = iter.next()) {
      o.value.send([0x90, pitch, velocity], window.performance.now());
    }
    setTimeout(() => {
      this.midiNoteOn(Date.now() - this.timePlayStart, pitch);
    }, 0);
    if (this.midiOutputs.values().next().done) {
      this.piano.keyDown({ midi: pitch });
    }
  }

  // Release note on Ouput MIDI Device
  midiReleaseNote(pitch: number): void {
    this.mapNotesAutoPressed.delete((pitch - 12).toFixed());
    if (this.bleMidiConnected) {
      this.sendMidiBle([0x80, pitch, 0x00]);
      setTimeout(() => {
        this.midiNoteOff(Date.now() - this.timePlayStart, pitch);
      }, 0);
      return;
    }
    const iter = this.midiOutputs.values();
    for (let o = iter.next(); !o.done; o = iter.next()) {
      o.value.send([0x80, pitch, 0x00], window.performance.now());
    }
    setTimeout(() => {
      this.midiNoteOff(Date.now() - this.timePlayStart, pitch);
    }, 0);
    if (this.midiOutputs.values().next().done) this.piano.keyUp({ midi: pitch });
  }

  // Midi input note pressed
  midiNoteOn(time: number, pitch: number /*, velocity: number*/): void {
    this.refreshWakeLock();
    const halbTone = pitch - 12;
    const name = halbTone.toFixed();
    this.notesService.press(name);

    // Key wrong pressed
    if (!this.notesService.getMapRequired().has(name)) {
      this.osmdTextFeedback('&#x1F308;', 0, 20);
    }

    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
    if (this.notesService.checkRequired()) {

      // All required notes has been pressed, turn off LED for all required notes
      this.turnOffAllRequiredLeds();

      this.osmdCursorPlayMoveNext();
    }
  }

  // Midi input note released
  midiNoteOff(time: number, pitch: number): void {
    const halbTone = pitch - 12;
    const name = halbTone.toFixed();
    this.notesService.release(name);

    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
    if (this.notesService.checkRequired()) this.osmdCursorPlayMoveNext();
  }

  // Refresh wakelock for two minutes
  refreshWakeLock(): void {
    if (!('wakeLock' in navigator)) return;
    // Only request wake lock if page is visible
    if (document.visibilityState !== 'visible') {
      // Optionally, set up a listener to re-acquire when visible
      if (!this._wakeLockVisibilityHandler) {
        this._wakeLockVisibilityHandler = () => {
          if (document.visibilityState === 'visible') {
            this.refreshWakeLock();
          }
        };
        document.addEventListener('visibilitychange', this._wakeLockVisibilityHandler);
      }
      return;
    }
    // Remove the visibilitychange handler if present
    if (this._wakeLockVisibilityHandler) {
      document.removeEventListener('visibilitychange', this._wakeLockVisibilityHandler);
      this._wakeLockVisibilityHandler = null;
    }
    try {
      if (!this.wakeLockObj) {
        navigator.wakeLock.request('screen').then((wakeLock) => {
          this.wakeLockObj = wakeLock;
          this.wakeLockObj.addEventListener('release', () => {
            this.wakeLockObj = undefined;
          });
        }).catch((err) => {
          // NotAllowedError: The requesting page is not visible
          // Just ignore, will retry on visibilitychange
          // console.log('wakelock failed to acquire: ' + err.message);
        });
      }
      // Maintain wake lock for 2 minutes
      clearTimeout(this.wakeLockTimer);
      this.wakeLockTimer = window.setTimeout(() => {
        if (this.wakeLockObj) this.wakeLockObj.release();
      }, 120000);
    } catch (err) {
      // Ignore errors
    }
  }

  // Add a private property for the visibility handler
  private _wakeLockVisibilityHandler: (() => void) | null = null;

  async openShippedScoreSelector() {
    const modal = await this.modalCtrl.create({
      component: ShippedScoreSelectorComponent
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data) {
      this.osmdLoadURL('assets/scores/' + data);
    }
  }

  async connectBleMidi() {
    if (!('bluetooth' in navigator)) {
      alert('Web Bluetooth API is not available in this browser. Please use Chrome or Edge on HTTPS.');
      this.bleMidiConnected = false;
      return;
    }
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'GZUT-MIDI' }],
        optionalServices: ['03b80e5a-ede8-4b33-a751-6ce34ec4c700']
      });
      this.bleMidiDevice = device;
      // Add disconnect event listener ONCE
      device.removeEventListener('gattserverdisconnected', this.handleBleMidiDisconnectBound);
      this.handleBleMidiDisconnectBound = this.handleBleMidiDisconnect.bind(this);
      device.addEventListener('gattserverdisconnected', this.handleBleMidiDisconnectBound);
      await this.connectGattServer();
    } catch (e) {
      alert('BLE MIDI connection failed: ' + e);
      this.bleMidiConnected = false;
    }
  }

  // Helper to connect GATT server and set up characteristic/notifications
  private async connectGattServer() {
    if (!this.bleMidiDevice) return;
    try {
      this.bleMidiServer = await this.bleMidiDevice.gatt?.connect() || null;
      if (!this.bleMidiServer) throw new Error('No GATT server');
      const service = await this.bleMidiServer.getPrimaryService('03b80e5a-ede8-4b33-a751-6ce34ec4c700');
      this.bleMidiCharacteristic = await service.getCharacteristic('7772e5db-3868-4112-a1a9-f2669d106bf3');
      await this.bleMidiCharacteristic.startNotifications();
      this.bleMidiCharacteristic.removeEventListener('characteristicvaluechanged', this.onBleMidiMessageBound);
      this.onBleMidiMessageBound = this.onBleMidiMessage.bind(this);
      this.bleMidiCharacteristic.addEventListener('characteristicvaluechanged', this.onBleMidiMessageBound);
      this.bleMidiConnected = true;
      this.midiDevice = 'GZUT-MIDI (BLE)';
      this.midiAvailable = true;
      this.changeRef.detectChanges();
      this.showUserMessage('BLE MIDI connected.');
    } catch (e) {
      this.bleMidiConnected = false;
      this.showUserMessage('BLE MIDI connection failed: ' + e);
      throw e;
    }
  }

  // BLE disconnect handler (bound in connectBleMidi)
  private handleBleMidiDisconnectBound: any = null;
  private onBleMidiMessageBound: any = null;
  private bleReconnectTries: number = 0;
  private bleReconnectMaxTries: number = 5;
  private bleReconnectDelay: number = 2000;
  private bleReconnectTimer: any = null;

  private handleBleMidiDisconnect() {
    this.bleMidiConnected = false;
    this.bleMidiServer = null;
    this.bleMidiCharacteristic = null;
    this.showUserMessage('BLE MIDI disconnected. Attempting to reconnect...');
    this.tryReconnectBleMidi();
  }

  private async tryReconnectBleMidi() {
    if (!this.bleMidiDevice) return;
    if (this.bleReconnectTries >= this.bleReconnectMaxTries) {
      this.showUserMessage('BLE MIDI reconnection failed after several attempts. Please reconnect manually.');
      return;
    }
    this.bleReconnectTries++;
    try {
      await this.connectGattServer();
      this.bleReconnectTries = 0;
      this.showUserMessage('BLE MIDI reconnected.');
    } catch (e) {
      this.bleReconnectTimer = setTimeout(() => this.tryReconnectBleMidi(), this.bleReconnectDelay * this.bleReconnectTries);
    }
  }

  // Show user feedback (can be improved to use a toast/snackbar)
  private showUserMessage(msg: string) {
    // For now, use alert, but can be replaced with a better UI feedback
    // alert(msg);
    console.log(msg);
  }

  // Override MIDI send to use BLE if connected, with queue
  sendMidiBle(data: number[]) {
    if (this.bleMidiConnected && this.bleMidiCharacteristic) {
      // BLE MIDI spec: prepend 0x80, 0x80 as timestamp (no running status)
      const msg = new Uint8Array([0x80, 0x80, ...data]);
      this.bleMidiWriteQueue.push(msg);
      this.processBleMidiQueue();
    } else {
      // Optionally, drop or queue until reconnected
      this.showUserMessage('BLE MIDI not connected. Message dropped.');
    }
  }

  private async processBleMidiQueue() {
    if (this.bleMidiWriting || !this.bleMidiConnected || !this.bleMidiCharacteristic) return;
    const msg = this.bleMidiWriteQueue.shift();
    if (!msg) return;
    this.bleMidiWriting = true;
    try {
      await this.bleMidiCharacteristic.writeValue(msg);
    } catch (e) {
      this.showUserMessage('BLE MIDI write error: ' + e);
      // If GATT disconnected, trigger disconnect handler
      if (this.bleMidiDevice && this.bleMidiDevice.gatt && !this.bleMidiDevice.gatt.connected) {
        this.handleBleMidiDisconnect();
      }
    } finally {
      this.bleMidiWriting = false;
      if (this.bleMidiWriteQueue.length > 0) {
        this.processBleMidiQueue();
      }
    }
  }

  // Handle incoming BLE MIDI messages
  private onBleMidiMessage(event: Event) {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    // BLE MIDI spec: skip first 2 bytes (timestamp), rest is MIDI data
    const data = new Uint8Array(value.buffer);
    if (data.length < 3) return;
    // Forward to MIDI input handler (simulate USB MIDI input)
    // Example: [0x80, 0x80, 0x90, pitch, velocity]
    const midiData = data.slice(2);
    // Only handle note on/off for now
    const cmd = midiData[0] & 0xf0;
    const pitch = midiData[1];
    const velocity = midiData[2];
    if (cmd === 0x90 && velocity > 0) {
      this.midiNoteOn(performance.now(), pitch);
    } else if ((cmd === 0x80) || (cmd === 0x90 && velocity === 0)) {
      this.midiNoteOff(performance.now(), pitch);
    }
  }
}
