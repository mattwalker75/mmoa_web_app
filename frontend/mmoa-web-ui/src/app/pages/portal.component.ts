import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { SiteService } from '../core/site.service';
import { City, OrgContact, OrgImage, PortalPayload } from '../core/models';
import { apiError } from '../core/errors';
import { resizeImage } from '../core/image-resize';
import { FIELD_RULES, US_STATES, formatPhone, maskInput, normalizeEmail, normalizeExt, typeEin, typeExt, typePhone } from '../core/formats';
import { ProfilePreviewDialogComponent } from '../shared/profile-preview-dialog.component';
import { PasswordInputComponent } from '../shared/password-input.component';

/** Profile fields with a Public/Hidden switch, in the order they appear. */
const TEXT_ROWS: { key: string; label: string; vis: string; type?: string; placeholder?: string; auto?: string }[] = [
  { key: 'phone', label: 'Phone', vis: 'phone', type: 'tel', placeholder: '(972) 555-0100', auto: 'tel' },
  { key: 'public_email', label: 'Public email', vis: 'public_email', type: 'email', placeholder: 'help@example.org', auto: 'email' },
  { key: 'website_url', label: 'Website', vis: 'website_url', placeholder: 'https://example.org', auto: 'url' },
  { key: 'facebook_url', label: 'Facebook', vis: 'facebook_url', placeholder: 'facebook.com/yourpage' },
  { key: 'instagram_url', label: 'Instagram', vis: 'instagram_url', placeholder: 'instagram.com/yourpage' },
  { key: 'other_social_url', label: 'Other link', vis: 'other_social_url', placeholder: 'Any other page about you' }
];

const FIELD_NAMES: Record<string, string> = {
  address: 'Address', phone: 'Phone', public_email: 'Public email', website_url: 'Website',
  facebook_url: 'Facebook', instagram_url: 'Instagram', other_social_url: 'Other link',
  description: 'Description', hours: 'Hours', what_to_bring: 'What to bring', contacts: 'Contacts',
  images: 'Photos', service_cities: 'Cities served', categories: 'Services'
};

type FormModel = Record<'name' | 'ein' | 'address_line1' | 'address_line2' | 'city' | 'state' | 'zip' | 'phone' | 'phone_ext' | 'public_email' |
  'website_url' | 'facebook_url' | 'instagram_url' | 'other_social_url' | 'description_md' | 'hours' | 'what_to_bring', string>;

/**
 * /portal (NonprofitPortal mockup) — the signed-in nonprofit edits its
 * "Need Help?" profile: organization details, services (categories +
 * cities), what to bring, contacts, photos (≤5; resized in the browser),
 * per-field Public/Hidden switches and the "list my organization" switch,
 * a "Preview public profile" pop-up (the real search card + full profile
 * page, from the last saved data), and login & password.
 * Text fields save together with "Save changes"; photo changes save at once.
 */
@Component({
  selector: 'app-portal',
  standalone: true,
  imports: [FormsModule, RouterLink, ProfilePreviewDialogComponent, PasswordInputComponent],
  template: `
    @if (!data()) {
      @if (loadErr()) { <div class="page"><div class="alert alert-error" role="alert">{{ loadErr() }}</div></div> }
      @else { <div class="loading"><span class="spinner light big" role="status" aria-label="Loading your profile"></span></div> }
    } @else {
      @switch (status()) {
        @case ('unverified') {
          <div class="banner" role="status"><div class="container">
            <strong>Pending verification.</strong>
            <span>You can edit everything now. Your profile appears in "Need Help?" search once MMoA verifies your EIN — usually within a few business days.</span>
          </div></div>
        }
        @case ('rejected') {
          <div class="banner banner-bad" role="status"><div class="container">
            <strong>We couldn't verify your organization.</strong>
            <span>Your profile isn't shown in "Need Help?". Please call us at <a [href]="'tel:' + site.phoneTel()" style="color:inherit">{{ site.phone() }}</a> so we can sort it out.</span>
          </div></div>
        }
        @default {
          <div class="banner banner-ok" role="status"><div class="container">
            <strong>Verified by MMoA.</strong>
            @if (data()!.isPublic) {
              <span>Your profile is live in "Need Help?". <a [routerLink]="['/need-help/org', data()!.org.org_id]" style="color:inherit">View your public profile</a></span>
            } @else {
              <span>Your profile is hidden — turn on "List my organization" under Visibility to show it in search.</span>
            }
          </div></div>
        }
      }

      <app-profile-preview-dialog [org]="data()!.preview" [isPublic]="data()!.isPublic" [loading]="previewLoading()" />

      <div class="page">
        <div class="portal">
          <nav class="portal-nav" aria-label="Profile sections">
            @for (s of sections; track s.id) {
              <a routerLink="/portal" [fragment]="s.id" [class.on]="frag() === s.id" [attr.aria-current]="frag() === s.id ? 'location' : null">{{ s.label }}{{ s.id === 'photos' ? ' (' + images().length + ' of ' + maxImages() + ')' : '' }}</a>
              @if (s.id === 'visibility') { <button type="button" class="nav-btn" (click)="openPreview()" aria-haspopup="dialog">Preview public profile</button> }
            }
          </nav>

          <form class="portal-main" (ngSubmit)="save()" novalidate>
            <!-- Organization -->
            <section id="organization" class="card" aria-labelledby="h-org">
              <div class="result-head">
                <h1 id="h-org">Organization</h1>
                <span class="muted small">"Public" fields show on your profile and in search</span>
              </div>
              <div style="margin-top:12px">
                <div class="prow">
                  <label for="p-name">Name</label>
                  <input id="p-name" class="input ctl" name="name" [(ngModel)]="f.name" maxlength="200" autocomplete="organization" required>
                  <span class="vis">Always public</span>
                </div>
                <div class="prow">
                  <label for="p-ein">EIN</label>
                  <div class="ctl">
                    <input id="p-ein" class="input" name="ein" [ngModel]="f.ein" (ngModelChange)="f.ein = typeEin($event)" (input)="mask($event, typeEin)" (blur)="check('ein')" maxlength="10" inputmode="numeric" placeholder="12-3456789" [disabled]="status() !== 'unverified'" [attr.aria-invalid]="!!errs()['ein']" aria-describedby="p-ein-hint p-ein-err">
                    @if (errs()['ein']) { <div class="field-err" id="p-ein-err" role="alert">{{ errs()['ein'] }}</div> }
                    <div class="hint" id="p-ein-hint">{{ status() === 'unverified' ? 'Used only to verify your 501(c)(3) status.' : "Locked after review — call us to change it." }}</div>
                  </div>
                  <span class="vis">Never public</span>
                </div>
                <div class="prow">
                  <label for="p-a1">Street address</label>
                  <div class="ctl">
                    <input id="p-a1" class="input" name="address_line1" [(ngModel)]="f.address_line1" maxlength="200" autocomplete="address-line1" placeholder="Street">
                    <input class="input" style="margin-top:8px" name="address_line2" [(ngModel)]="f.address_line2" maxlength="200" autocomplete="address-line2" placeholder="Suite / building (optional)" aria-label="Address line 2">
                    <div class="grid-3" style="margin-top:8px">
                      <input class="input" name="city" [(ngModel)]="f.city" maxlength="100" autocomplete="address-level2" placeholder="City" aria-label="City">
                      <input class="input" name="state" list="us-states" [(ngModel)]="f.state" (blur)="check('state')" maxlength="40" autocomplete="address-level1" placeholder="State" aria-label="State" [attr.aria-invalid]="!!errs()['state']" aria-describedby="p-state-err">
                      <input class="input" name="zip" [(ngModel)]="f.zip" maxlength="10" inputmode="numeric" autocomplete="postal-code" placeholder="ZIP" aria-label="ZIP code">
                    </div>
                    <datalist id="us-states">@for (st of states; track st[0]) { <option [value]="st[0]">{{ st[1] }}</option> }</datalist>
                    @if (errs()['state']) { <div class="field-err" id="p-state-err" role="alert">{{ errs()['state'] }}</div> }
                  </div>
                  <button type="button" class="vis-btn" [attr.aria-pressed]="isPub('address')" (click)="flip('address')" [attr.aria-label]="'Address: ' + (isPub('address') ? 'public' : 'hidden')">{{ isPub('address') ? 'Public' : 'Hidden' }}</button>
                </div>
                @for (r of textRows; track r.key) {
                  <div class="prow">
                    <label [for]="'p-' + r.key">{{ r.label }}</label>
                    <div class="ctl">
                      <input class="input" [id]="'p-' + r.key" [name]="r.key" [type]="r.type || 'text'" [placeholder]="r.placeholder || ''"
                        [attr.autocomplete]="r.auto || 'off'" maxlength="500" [attr.inputmode]="r.key === 'phone' ? 'tel' : null"
                        [ngModel]="getF(r.key)" (ngModelChange)="setF(r.key, $event)" (input)="r.key === 'phone' && mask($event, typePhone)" (blur)="check(r.key)"
                        [attr.aria-invalid]="!!errs()[r.key]" [attr.aria-describedby]="errs()[r.key] ? 'p-err-' + r.key : null">
                      @if (r.key === 'phone') {
                        <div class="ext-row">
                          <label for="p-phone_ext">Ext.</label>
                          <input id="p-phone_ext" class="input ext" name="phone_ext" inputmode="numeric" maxlength="6" placeholder="Optional"
                            [ngModel]="f.phone_ext" (ngModelChange)="f.phone_ext = typeExt($event)" (input)="mask($event, typeExt)" (blur)="check('phone_ext')"
                            [attr.aria-invalid]="!!errs()['phone_ext']">
                        </div>
                        @if (errs()['phone_ext']) { <div class="field-err" role="alert">{{ errs()['phone_ext'] }}</div> }
                      }
                      @if (errs()[r.key]) { <div class="field-err" [id]="'p-err-' + r.key" role="alert">{{ errs()[r.key] }}</div> }
                    </div>
                    <button type="button" class="vis-btn" [attr.aria-pressed]="isPub(r.vis)" (click)="flip(r.vis)" [attr.aria-label]="r.label + ': ' + (isPub(r.vis) ? 'public' : 'hidden')">{{ isPub(r.vis) ? 'Public' : 'Hidden' }}</button>
                  </div>
                }
                <div class="prow">
                  <label for="p-desc">About your organization</label>
                  <div class="ctl">
                    <textarea id="p-desc" class="textarea" name="description_md" rows="6" maxlength="5000" [(ngModel)]="f.description_md" aria-describedby="p-desc-hint"></textarea>
                    <div class="hint" id="p-desc-hint">What you offer and who you serve. Simple formatting: **bold**, *italic*, [link text](https://…), and lines starting with "- " for a list. A blank line starts a new paragraph.</div>
                  </div>
                  <button type="button" class="vis-btn" [attr.aria-pressed]="isPub('description')" (click)="flip('description')" [attr.aria-label]="'Description: ' + (isPub('description') ? 'public' : 'hidden')">{{ isPub('description') ? 'Public' : 'Hidden' }}</button>
                </div>
                <div class="prow">
                  <label for="p-hours">Hours</label>
                  <textarea id="p-hours" class="textarea ctl" style="min-height:70px" name="hours" rows="2" maxlength="1000" [(ngModel)]="f.hours" placeholder="e.g. Tue & Thu 9 AM – 12 PM"></textarea>
                  <button type="button" class="vis-btn" [attr.aria-pressed]="isPub('hours')" (click)="flip('hours')" [attr.aria-label]="'Hours: ' + (isPub('hours') ? 'public' : 'hidden')">{{ isPub('hours') ? 'Public' : 'Hidden' }}</button>
                </div>
              </div>
            </section>

            <!-- Services -->
            <section id="services" class="card" aria-labelledby="h-svc">
              <div class="sec-vis">
                <h2 id="h-svc" style="margin:0">Services we provide</h2>
                <button type="button" class="vis-btn" [attr.aria-pressed]="isPub('categories')" (click)="flip('categories')" [attr.aria-label]="'Services: ' + (isPub('categories') ? 'public' : 'hidden')">{{ isPub('categories') ? 'Public' : 'Hidden' }}</button>
              </div>
              <p class="muted">Pick every category that fits — people search by these. (Hidden categories aren't used for search either.)</p>
              <div class="cat-checks" role="group" aria-label="Service categories">
                @for (c of data()!.options.categories; track c.slug) {
                  <button type="button" class="svc-tile" [attr.aria-pressed]="cats().includes(c.slug)" (click)="toggleCat(c.slug)">{{ c.name }}</button>
                }
              </div>
              <div class="sec-vis" style="margin-top:22px">
                <h3 style="margin:0;font-size:22px">Cities we serve</h3>
                <button type="button" class="vis-btn" [attr.aria-pressed]="isPub('service_cities')" (click)="flip('service_cities')" [attr.aria-label]="'Cities served: ' + (isPub('service_cities') ? 'public' : 'hidden')">{{ isPub('service_cities') ? 'Public' : 'Hidden' }}</button>
              </div>
              <div class="tag-row" style="align-items:center">
                @for (c of chosenCities(); track c.city_id) {
                  <span class="city-chip">{{ c.name }} <button type="button" (click)="removeCity(c.city_id)" [attr.aria-label]="'Remove ' + c.name">×</button></span>
                } @empty { <span class="muted">No cities yet.</span> }
                @if (otherCities().length) {
                  <label class="sr-only" for="p-addcity">Add a city</label>
                  <select id="p-addcity" class="select" style="width:auto;min-height:44px" [ngModel]="''" name="addcity" (ngModelChange)="addCity($event)">
                    <option value="">+ Add city</option>
                    @for (c of otherCities(); track c.city_id) { <option [value]="c.city_id">{{ c.name }}</option> }
                  </select>
                }
              </div>
            </section>

            <!-- What to bring -->
            <section id="bring" class="card" aria-labelledby="h-bring">
              <div class="sec-vis">
                <h2 id="h-bring" style="margin:0">What to bring</h2>
                <button type="button" class="vis-btn" [attr.aria-pressed]="isPub('what_to_bring')" (click)="flip('what_to_bring')" [attr.aria-label]="'What to bring: ' + (isPub('what_to_bring') ? 'public' : 'hidden')">{{ isPub('what_to_bring') ? 'Public' : 'Hidden' }}</button>
              </div>
              <label for="p-bring" style="display:block;margin-bottom:8px">
                <span style="display:block;font-weight:600">Enter the items and information people will need to bring with them when asking for your help.</span>
                <span class="muted">One item per line — e.g. "Photo ID", "Proof of address".</span>
              </label>
              <textarea id="p-bring" class="textarea" name="what_to_bring" rows="5" maxlength="2000" [(ngModel)]="f.what_to_bring"></textarea>
            </section>

            <!-- Contacts -->
            <section id="contacts" class="card" aria-labelledby="h-contacts">
              <div class="sec-vis">
                <h2 id="h-contacts" style="margin:0">Contacts</h2>
                <button type="button" class="vis-btn" [attr.aria-pressed]="isPub('contacts')" (click)="flip('contacts')" [attr.aria-label]="'Contacts: ' + (isPub('contacts') ? 'public' : 'hidden')">{{ isPub('contacts') ? 'Public' : 'Hidden' }}</button>
              </div>
              <p class="muted">People at your organization. Only contacts marked "Show publicly" appear on your profile.</p>
              @for (c of contacts; track $index; let i = $index) {
                <div class="contact-row" role="group" [attr.aria-label]="'Contact ' + (i + 1)">
                  <div class="field c-name"><label [for]="'c-name-' + i">Name</label><input class="input" [id]="'c-name-' + i" [name]="'c-name-' + i" maxlength="200" [(ngModel)]="c.name"></div>
                  <div class="field c-role"><label [for]="'c-role-' + i">Role</label><input class="input" [id]="'c-role-' + i" [name]="'c-role-' + i" maxlength="200" [(ngModel)]="c.role"></div>
                  <div class="field c-email"><label [for]="'c-email-' + i">Email</label><input class="input" type="email" [id]="'c-email-' + i" [name]="'c-email-' + i" maxlength="255" [(ngModel)]="c.email" (blur)="checkContact(i, 'email')" [attr.aria-invalid]="!!errs()['c-email-' + i]">
                    @if (errs()['c-email-' + i]) { <div class="field-err" role="alert">{{ errs()['c-email-' + i] }}</div> }</div>
                  <div class="field c-phone"><label [for]="'c-phone-' + i">Phone</label><input class="input" type="tel" inputmode="tel" [id]="'c-phone-' + i" [name]="'c-phone-' + i" maxlength="32" placeholder="(972) 555-0100" [ngModel]="c.phone" (ngModelChange)="c.phone = typePhone($event)" (input)="mask($event, typePhone)" (blur)="checkContact(i, 'phone')" [attr.aria-invalid]="!!errs()['c-phone-' + i]">
                    @if (errs()['c-phone-' + i]) { <div class="field-err" role="alert">{{ errs()['c-phone-' + i] }}</div> }</div>
                  <div class="field c-ext"><label [for]="'c-ext-' + i">Ext.</label><input class="input" inputmode="numeric" maxlength="6" placeholder="Optional" [id]="'c-ext-' + i" [name]="'c-ext-' + i" [ngModel]="c.phone_ext || ''" (ngModelChange)="c.phone_ext = typeExt($event)" (input)="mask($event, typeExt)"></div>
                  <div class="btn-row c-actions" style="gap:4px">
                    <label class="check"><input type="checkbox" [name]="'c-pub-' + i" [(ngModel)]="c.is_public"> Show publicly</label>
                    <button type="button" class="btn btn-danger btn-sm" (click)="removeContact(i)" [attr.aria-label]="'Remove contact ' + (c.name || (i + 1))">Remove</button>
                  </div>
                </div>
              } @empty { <p class="muted">No contacts yet.</p> }
              @if (contacts.length < 10) { <button type="button" class="btn btn-ghost" (click)="addContact()">+ Add contact</button> }
            </section>

            <!-- Photos -->
            <section id="photos" class="card" aria-labelledby="h-photos">
              <div class="sec-vis">
                <h2 id="h-photos" style="margin:0">Photos</h2>
                <button type="button" class="vis-btn" [attr.aria-pressed]="isPub('images')" (click)="flip('images')" [attr.aria-label]="'Photos: ' + (isPub('images') ? 'public' : 'hidden')">{{ isPub('images') ? 'Public' : 'Hidden' }}</button>
              </div>
              <p class="muted">Up to {{ maxImages() }} images (JPG, PNG or WebP). They're resized automatically. Photo changes save right away.</p>
              <div aria-live="polite">
                @if (photoErr()) { <div class="alert alert-error">{{ photoErr() }}</div> }
                @if (photoMsg()) { <div class="alert alert-success">{{ photoMsg() }}</div> }
              </div>
              <div class="photo-grid-edit">
                @for (img of images(); track img.image_id; let i = $index; let first = $first; let last = $last) {
                  <div class="photo-tile">
                    <img [src]="img.url" [alt]="img.alt || 'Photo ' + (i + 1)">
                    <label class="sr-only" [for]="'alt-' + img.image_id">Description of photo {{ i + 1 }}</label>
                    <input class="input" [id]="'alt-' + img.image_id" [name]="'alt-' + img.image_id" maxlength="300" placeholder="Describe this photo" [ngModel]="img.alt" (change)="saveAlt(img, $event)">
                    <div class="tools">
                      <button type="button" (click)="move(i, -1)" [disabled]="first || photoBusy()" [attr.aria-label]="'Move photo ' + (i + 1) + ' earlier'">←</button>
                      <button type="button" (click)="move(i, 1)" [disabled]="last || photoBusy()" [attr.aria-label]="'Move photo ' + (i + 1) + ' later'">→</button>
                      <button type="button" (click)="deletePhoto(img)" [disabled]="photoBusy()" [attr.aria-label]="'Delete photo ' + (i + 1)">Delete</button>
                    </div>
                  </div>
                }
                @if (images().length < maxImages()) {
                  <button type="button" class="add-photo" (click)="file.click()" [disabled]="photoBusy()">
                    @if (photoBusy()) { <span class="spinner light" role="status" aria-label="Uploading"></span> } @else { + Add photo }
                  </button>
                }
              </div>
              <input #file type="file" accept="image/jpeg,image/png,image/webp" hidden (change)="upload($event)">
            </section>

            <!-- Visibility -->
            <section id="visibility" class="card" aria-labelledby="h-vis">
              <h2 id="h-vis">Visibility</h2>
              <label class="switch"><input type="checkbox" name="is_listed" [checked]="listed()" (change)="listed.set(!listed())"> List my organization in "Need Help?"</label>
              <p class="muted" style="margin-top:8px">Turn this off to hide your whole profile from search for a while. Your organization's name is always public when listed; your EIN and your login email are never public.</p>
              <p class="soft" style="margin:0"><strong>Public now:</strong> {{ publicSummary() || 'Name only' }}</p>
              @if (hiddenSummary()) { <p class="muted" style="margin:4px 0 0"><strong>Hidden:</strong> {{ hiddenSummary() }}</p> }
            </section>

            <div class="save-bar">
              <span aria-live="polite" class="small">
                @if (saveErr()) { <span style="color:var(--danger-text)" role="alert">{{ saveErr() }}</span> }
                @if (saveMsg()) { <span style="color:var(--chip-text)">{{ saveMsg() }}</span> }
              </span>
              <button type="button" class="btn btn-primary" (click)="openPreview()" aria-haspopup="dialog">Preview Public Profile</button>
              <button type="submit" class="btn btn-primary" [disabled]="saving()">
                @if (saving()) { <span class="spinner" role="status" aria-label="Saving"></span> } @else { Save changes }
              </button>
            </div>


            <!-- Login & password -->
            <section id="login" class="card" aria-labelledby="h-login">
              <h2 id="h-login">Login &amp; password</h2>
              @if (data()!.account; as a) {
                <dl class="kv" style="margin-bottom:18px">
                  <dt>Primary contact</dt><dd>{{ a.first_name }} {{ a.last_name }}</dd>
                  <dt>Login name</dt><dd>{{ a.login_name }}</dd>
                  <dt>Login email</dt><dd>{{ a.email }}</dd>
                </dl>
                <p class="muted small">To change the contact name or login email, call MMoA at {{ site.phone() }}.</p>
              }
              <h3 style="font-size:22px">Change password</h3>
              <div aria-live="polite">
                @if (pwErr()) { <div class="alert alert-error">{{ pwErr() }}</div> }
                @if (pwMsg()) { <div class="alert alert-success">{{ pwMsg() }}</div> }
              </div>
              <div class="grid-2">
                <div class="field"><label for="pw-cur">Current password</label><app-password-input inputId="pw-cur" [(value)]="curPw" autocomplete="current-password" /></div>
                <div></div>
                <div class="field"><label for="pw-new">New password</label>
                  <app-password-input inputId="pw-new" [(value)]="newPw" [show]="showPw()" (showChange)="showPw.set($event)" autocomplete="new-password" [minlength]="minLen()" />
                  <span class="hint">At least {{ minLen() }} characters.</span></div>
                <div class="field"><label for="pw-new2">Confirm new password</label>
                  <app-password-input inputId="pw-new2" [(value)]="newPw2" [show]="showPw()" (showChange)="showPw.set($event)" autocomplete="new-password" /></div>
              </div>
              <button type="button" class="btn btn-outline" (click)="changePassword()" [disabled]="pwBusy()">Update password</button>
            </section>
          </form>
        </div>
      </div>
    }
  `
})
export class PortalComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  site = inject(SiteService);
  @ViewChild('file') fileInput?: ElementRef<HTMLInputElement>;

  sections = [
    { id: 'organization', label: 'Organization' }, { id: 'services', label: 'Services we provide' },
    { id: 'bring', label: 'What to bring' }, { id: 'contacts', label: 'Contacts' }, { id: 'photos', label: 'Photos' },
    { id: 'visibility', label: 'Visibility' }, { id: 'login', label: 'Login & password' }
  ];
  textRows = TEXT_ROWS;

  data = signal<PortalPayload | null>(null);
  loadErr = signal('');
  frag = signal('organization');
  status = computed(() => this.data()?.org.verification_status || 'unverified');
  maxImages = computed(() => this.data()?.options.maxImages || 5);

  f: FormModel = this.blankForm();
  pub = signal<string[]>([]);
  listed = signal(true);
  cats = signal<string[]>([]);
  cityIds = signal<number[]>([]);
  contacts: OrgContact[] = [];
  images = signal<OrgImage[]>([]);

  saving = signal(false);
  saveMsg = signal('');
  saveErr = signal('');
  photoBusy = signal(false);
  photoErr = signal('');
  photoMsg = signal('');

  curPw = ''; newPw = ''; newPw2 = '';
  showPw = signal(false);
  pwBusy = signal(false);
  pwErr = signal('');
  pwMsg = signal('');

  chosenCities = computed<City[]>(() => (this.data()?.options.cities || []).filter(c => this.cityIds().includes(c.city_id)));
  otherCities = computed<City[]>(() => (this.data()?.options.cities || []).filter(c => !this.cityIds().includes(c.city_id)));
  publicSummary = computed(() => this.pub().map(k => FIELD_NAMES[k]).filter(Boolean).join(', '));
  hiddenSummary = computed(() => Object.keys(FIELD_NAMES).filter(k => !this.pub().includes(k)).map(k => FIELD_NAMES[k]).join(', '));

  constructor() {
    this.route.fragment.subscribe(fr => { if (fr) this.frag.set(fr); });
    this.load();
  }

  private blankForm(): FormModel {
    return { name: '', ein: '', address_line1: '', address_line2: '', city: '', state: 'TX', zip: '', phone: '', phone_ext: '', public_email: '',
      website_url: '', facebook_url: '', instagram_url: '', other_social_url: '', description_md: '', hours: '', what_to_bring: '' };
  }

  private async load() {
    try {
      this.apply(await firstValueFrom(this.api.portalOrg()));
    } catch (err) {
      this.loadErr.set(apiError(err, "We couldn't load your profile. Please try again."));
    }
  }

  /** Copy a server payload into the editable model. */
  private apply(p: PortalPayload) {
    const o = p.org;
    const f = this.blankForm();
    for (const k of Object.keys(f) as (keyof FormModel)[]) f[k] = (o as unknown as Record<string, string>)[k] ?? '';
    if (!f.state) f.state = 'TX';
    this.errs.set({});
    this.f = f;
    this.pub.set([...o.public_fields]);
    this.listed.set(o.is_listed);
    this.cats.set([...o.categories]);
    this.cityIds.set([...o.city_ids]);
    this.contacts = o.contacts.map(c => ({ ...c }));
    this.images.set(o.images);
    this.data.set(p);
  }

  getF(k: string): string { return this.f[k as keyof FormModel]; }
  setF(k: string, v: string) { this.f[k as keyof FormModel] = k === 'phone' ? typePhone(v) : v; }

  // ── Field formatting / validation (rules in core/formats.ts) ───────────
  states = US_STATES;
  typeEin = typeEin;
  typePhone = typePhone;
  typeExt = typeExt;
  /** Keep the box itself in step with the formatter (see maskInput). */
  mask(e: Event, fmt: (v: string) => string) { maskInput(e, fmt); }
  errs = signal<Record<string, string>>({});
  private setErr(key: string, msg: string) { this.errs.update(e => { const n = { ...e }; if (msg) n[key] = msg; else delete n[key]; return n; }); }
  /** On leaving a field: store the clean form, or show why it isn't valid. */
  check(key: string): boolean {
    const rule = FIELD_RULES[key];
    if (!rule || (key === 'ein' && this.status() !== 'unverified')) return true;
    const v = rule[0](this.getF(key));
    if (v === null) { this.setErr(key, rule[1]); return false; }
    this.f[key as keyof FormModel] = v;
    this.setErr(key, '');
    return true;
  }
  checkContact(i: number, kind: 'email' | 'phone'): boolean {
    const c = this.contacts[i];
    if (!c) return true;
    if (kind === 'phone') c.phone_ext = normalizeExt(c.phone_ext || '') ?? '';
    const v = kind === 'email' ? normalizeEmail(c.email) : formatPhone(c.phone);
    const key = `c-${kind}-${i}`;
    if (v === null) {
      this.setErr(key, kind === 'email' ? 'Enter an email like name@example.org.' : 'Enter a 10-digit phone number, like (972) 555-0100.');
      return false;
    }
    c[kind] = v;
    this.setErr(key, '');
    return true;
  }
  /** Check every rule before saving; focus the first problem field. */
  private checkAll(): boolean {
    let ok = true;
    for (const k of Object.keys(FIELD_RULES)) ok = this.check(k) && ok;
    this.contacts.forEach((_, i) => { ok = this.checkContact(i, 'email') && ok; ok = this.checkContact(i, 'phone') && ok; });
    if (!ok) setTimeout(() => (document.querySelector('.portal-main [aria-invalid="true"]') as HTMLElement | null)?.focus());
    return ok;
  }
  isPub(k: string) { return this.pub().includes(k); }
  flip(k: string) { this.pub.set(this.isPub(k) ? this.pub().filter(x => x !== k) : [...this.pub(), k]); }
  toggleCat(slug: string) { this.cats.set(this.cats().includes(slug) ? this.cats().filter(s => s !== slug) : [...this.cats(), slug]); }
  addCity(id: string) { const n = Number(id); if (n && !this.cityIds().includes(n)) this.cityIds.set([...this.cityIds(), n]); }
  removeCity(id: number) { this.cityIds.set(this.cityIds().filter(x => x !== id)); }
  addContact() { this.contacts = [...this.contacts, { name: '', role: '', email: '', phone: '', phone_ext: '', is_public: false }]; }
  removeContact(i: number) { this.contacts = this.contacts.filter((_, j) => j !== i); this.errs.update(e => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('c-')))); }
  minLen() { return this.auth.config()?.passwordMinLength || 8; }

  async save() {
    if (this.saving()) return;
    this.saveMsg.set(''); this.saveErr.set('');
    if ((this.f.name || '').trim().length < 2) { this.saveErr.set('Please enter your organization name.'); return; }
    if (!this.checkAll()) { this.saveErr.set('Please fix the highlighted fields.'); return; }
    const body: Record<string, unknown> = {
      ...this.f,
      public_fields: this.pub(),
      is_listed: this.listed(),
      contacts: this.contacts.map(c => ({ name: c.name, role: c.role, email: c.email, phone: c.phone, phone_ext: c.phone ? (c.phone_ext || '') : '', is_public: c.is_public })),
      categories: this.cats(),
      city_ids: this.cityIds()
    };
    if (this.status() !== 'unverified') delete body['ein'];
    this.saving.set(true);
    try {
      const res = await firstValueFrom(this.api.savePortalOrg(body));
      this.apply(res);
      this.saveMsg.set(res.message || 'Saved.');
      setTimeout(() => this.saveMsg.set(''), 6000);
    } catch (err) {
      this.saveErr.set(apiError(err, 'Could not save your changes.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ── Photos (each action saves immediately) ──────────────────────────────
  async upload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    this.photoErr.set(''); this.photoMsg.set('');
    this.photoBusy.set(true);
    try {
      const blob = await resizeImage(file);
      const res = await firstValueFrom(this.api.uploadOrgImage(blob, ''));
      this.images.set(res.images);
      this.photoMsg.set('Photo added. Add a short description so screen-reader users know what it shows.');
      await this.refreshPreview();
    } catch (err) {
      this.photoErr.set(err instanceof Error && !(err as { status?: number }).status ? err.message : apiError(err, 'Could not upload that photo.'));
    } finally {
      this.photoBusy.set(false);
    }
  }

  async move(i: number, dir: -1 | 1) {
    const list = [...this.images()];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await this.photoOp(() => this.api.orderOrgImages(list.map(x => x.image_id), {}));
  }

  async saveAlt(img: OrgImage, e: Event) {
    const alt = (e.target as HTMLInputElement).value;
    await this.photoOp(() => this.api.orderOrgImages(this.images().map(x => x.image_id), { [img.image_id]: alt }), 'Description saved.');
  }

  async deletePhoto(img: OrgImage) {
    if (!confirm('Delete this photo? This cannot be undone.')) return;
    await this.photoOp(() => this.api.deleteOrgImage(img.image_id), 'Photo deleted.');
  }

  private async photoOp(call: () => ReturnType<ApiService['deleteOrgImage']>, okMsg = '') {
    this.photoErr.set(''); this.photoMsg.set('');
    this.photoBusy.set(true);
    try {
      const res = await firstValueFrom(call());
      this.images.set(res.images);
      if (okMsg) this.photoMsg.set(okMsg);
      await this.refreshPreview();
    } catch (err) {
      this.photoErr.set(apiError(err, 'Could not update your photos.'));
    } finally {
      this.photoBusy.set(false);
    }
  }

  // ── Preview pop-up ──────────────────────────────────────────────────────
  @ViewChild(ProfilePreviewDialogComponent) previewDlg?: ProfilePreviewDialogComponent;
  previewLoading = signal(false);
  /** Open the pop-up, then pull the latest SAVED public view into it. */
  async openPreview() {
    this.previewLoading.set(true);
    this.previewDlg?.open();
    await this.refreshPreview();
    this.previewLoading.set(false);
  }

  /** Re-read the saved preview after a photo change (keeps unsaved text edits). */
  private async refreshPreview() {
    try {
      const p = await firstValueFrom(this.api.portalOrg());
      const cur = this.data();
      if (cur) this.data.set({ ...cur, preview: p.preview, isPublic: p.isPublic });
    } catch { /* preview just stays as it was */ }
  }

  // ── Password ────────────────────────────────────────────────────────────
  async changePassword() {
    if (this.pwBusy()) return;
    this.pwErr.set(''); this.pwMsg.set('');
    if (!this.curPw) { this.pwErr.set('Enter your current password.'); return; }
    if (this.newPw.length < this.minLen()) { this.pwErr.set(`New password must be at least ${this.minLen()} characters.`); return; }
    if (this.newPw !== this.newPw2) { this.pwErr.set('New passwords do not match.'); return; }
    this.pwBusy.set(true);
    try {
      const res = await firstValueFrom(this.api.changePassword({ current_password: this.curPw, new_password: this.newPw, confirm_password: this.newPw2 }));
      this.curPw = ''; this.newPw = ''; this.newPw2 = '';
      this.pwMsg.set(res.message || 'Your password has been updated.');
    } catch (err) {
      this.pwErr.set(apiError(err, 'Could not update your password.'));
    } finally {
      this.pwBusy.set(false);
    }
  }
}
