import { Component, EventEmitter, Input, Output, model } from '@angular/core';

/**
 * Password field with a Show/Hide toggle so users can confirm what they typed.
 * Two-way bindable via [(value)]. The Show/Hide state is also two-way bindable
 * via [(show)] — bind several inputs to one signal to link their toggles.
 */
@Component({
  selector: 'app-password-input',
  standalone: true,
  template: `
    <div class="input-group">
      <input class="input"
        [type]="show() ? 'text' : 'password'"
        [value]="value"
        (input)="onInput($event)"
        [attr.placeholder]="placeholder || null"
        [attr.autocomplete]="autocomplete"
        [attr.minlength]="minlength || null"
        [attr.aria-label]="placeholder || 'Password'" />
      <button type="button" class="input-affix" (click)="show.set(!show())"
        [attr.aria-label]="show() ? 'Hide password' : 'Show password'">
        {{ show() ? 'Hide' : 'Show' }}
      </button>
    </div>
  `
})
export class PasswordInputComponent {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
  @Input() placeholder = '';
  @Input() autocomplete = 'new-password';
  @Input() minlength?: number;
  show = model(false);

  onInput(e: Event) {
    this.value = (e.target as HTMLInputElement).value;
    this.valueChange.emit(this.value);
  }
}
