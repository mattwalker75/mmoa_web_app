Images for the website live here (committed; served at /content/images/).

- The admin console's Web App Website page can add/replace files here.
- Reference them in the HTML/*.html section files as:  /content/images/<filename>
  e.g.  <img src="/content/images/carshow.jpg" alt="...">
- carshow, booth, group, angeltree, fundraiser, volunteers, legion .jpg are the
  site photos (hero background, home photo grid, About gallery). The SPA uses
  the same filenames, so replace a photo by overwriting it with the same name.
- Optional logo: logo.png (or logo.svg) here replaces the built-in stand-in
  eagle SVG in the site header, and logo.png is also shown on the maintenance
  screen.
- Uploaded images (events, raffles, nonprofit photos, board photos) do NOT
  live here — they go to uploads/ (gitignored), served at /uploads/.
