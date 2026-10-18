// src/app/pipes/date-formatter.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'dateFormatter'
})
export class DateFormatterPipe implements PipeTransform {
  transform(value: Date): string {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (value.toDateString() === today.toDateString()) {
      return 'Сьогодні';
    } else if (value.toDateString() === yesterday.toDateString()) {
      return 'Вчора';
    } else {
      return value.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
}