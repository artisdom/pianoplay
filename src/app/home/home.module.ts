// [PianoPlay](https://michaelecke.com/pianoplay) - Copyright (c) 2021 Rodrigo Jorge Vilar de Linares.

import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

import { PianoKeyboardComponent } from '../piano-keyboard/piano-keyboard.component';
import { HomePageComponent } from './home.page';
import { HomePageRoutingModule } from './home-routing.module';
import { ShippedScoreSelectorComponent } from './shipped-score-selector.component';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, HomePageRoutingModule, TranslateModule],
  declarations: [HomePageComponent, PianoKeyboardComponent, ShippedScoreSelectorComponent],
})
export class HomePageModule {}
