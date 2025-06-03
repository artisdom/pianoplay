import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ModalController } from '@ionic/angular';

interface ScoreGroup {
  group: string;
  scores: string[];
  open: boolean;
}

@Component({
  selector: 'app-shipped-score-selector',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Select a Shipped Score</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">Close</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list *ngIf="scoreGroups.length">
        <ion-item-group *ngFor="let group of scoreGroups">
          <ion-item-divider color="light" (click)="toggleGroup(group)">
            <ion-icon [name]="group.open ? 'chevron-down' : 'chevron-forward'" slot="start"></ion-icon>
            <ion-label><strong>{{ group.group }}</strong></ion-label>
          </ion-item-divider>
          <div *ngIf="group.open">
            <ion-item *ngFor="let score of group.scores" (click)="selectScore(score)">
              {{ getScoreName(score) }}
            </ion-item>
          </div>
        </ion-item-group>
      </ion-list>
      <ion-label *ngIf="!scoreGroups.length">No shipped scores found.</ion-label>
    </ion-content>
  `,
  styles: [`ion-item { cursor: pointer; }`]
})
export class ShippedScoreSelectorComponent implements OnInit {
  scoreGroups: ScoreGroup[] = [];

  constructor(private http: HttpClient, private modalCtrl: ModalController) {}

  ngOnInit() {
    this.http.get<string[]>('assets/scores/list.json').subscribe({
      next: (data) => this.scoreGroups = this.groupScores(data),
      error: () => this.scoreGroups = []
    });
  }

  groupScores(scores: string[]): ScoreGroup[] {
    const groups: { [key: string]: string[] } = {};
    for (const score of scores) {
      const [group, ...rest] = score.split('/');
      if (!groups[group]) groups[group] = [];
      groups[group].push(score);
    }
    return Object.keys(groups).sort().map(group => ({
      group,
      scores: groups[group].sort((a, b) => this.getScoreName(a).localeCompare(this.getScoreName(b))),
      open: false
    }));
  }

  getScoreName(score: string): string {
    const parts = score.split('/');
    return parts[parts.length - 1].replace(/\.musicxml$/, '');
  }

  toggleGroup(group: ScoreGroup) {
    group.open = !group.open;
  }

  selectScore(score: string) {
    this.modalCtrl.dismiss(score);
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }
}
