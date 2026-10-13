# CertiBulk — Bulk Certificate Generator

Aplikasi web statis untuk membuat sertifikat massal: unggah template kosong, atur posisi & gaya nama secara visual, tempel/impor daftar peserta, lalu unduh semua sertifikat dalam satu ZIP. **Semua proses berjalan di browser Anda** — tidak ada upload ke server, login, API key, atau analytics.

## Menjalankan

Aplikasi hanya terdiri dari file statis. Jalankan lewat server lokal (disarankan, agar font & library dimuat dengan benar):

```bash
cd certibulk
python3 -m http.server 8000      # lalu buka http://localhost:8000
# atau
npx serve .
```

Bisa juga di-hosting di static hosting mana pun (GitHub Pages, Netlify, Nginx, dll.). Tidak ada langkah build.

**Offline:** `jszip.min.js` dan semua font ada di `assets/` dan tidak ada referensi CDN. Setelah file aplikasi tersedia lokal, aplikasi tidak butuh internet.

## Cara pakai

1. **Template** — seret/pilih gambar PNG/JPG sertifikat kosong. Resolusi asli dipertahankan.
2. **Name Editor** — seret teks "Nama Peserta" di canvas (mouse/sentuh), atau isi X/Y. Panah keyboard menggeser 1 px (Shift = 10 px) saat canvas difokuskan. Atur font, ukuran, warna, alignment, letter spacing, lebar maksimum, rotasi, auto-fit.
3. **Participants** — tempel nama (satu per baris), impor `.txt`, atau impor `.csv` (pemilihan kolom jika banyak kolom). Edit, hapus, cari, dan peringatan duplikat tersedia.
4. **Preview** — mode *Desain* (nama contoh) atau *Peserta* (navigasi per nama; klik baris tabel juga bisa).
5. **Export** — pilih PNG/JPG (+ kualitas), pola nama file, nama ZIP, lalu **Generate Certificates** dan unduh ZIP.

### Konvensi koordinat
Satuan = piksel pada resolusi **asli template**. `X` adalah anchor horizontal sesuai alignment (kiri / tengah / kanan teks); `Y` adalah **baseline** teks. Rotasi berputar di sekitar titik anchor (X, Y). Preview dan ekspor memakai fungsi render yang sama (`CB.renderCertificate`), sehingga posisinya identik.

### Pola nama file
`{name}` = nama peserta (sudah dibersihkan dari karakter terlarang: `\ / : * ? " < > |`), `{index}` = nomor urut berpadding (001, 002, …). Contoh: `{index}_{name}` → `001_Ahmad_Fauzan.png`. Nama kembar (tanpa membedakan huruf besar/kecil) diberi akhiran `_2`, `_3`, … agar tidak saling menimpa. Nama di dalam sertifikat tidak diubah.

## Struktur proyek

```
certibulk/
├── index.html
├── assets/
│   ├── css/style.css          # desain + @font-face lokal
│   ├── js/
│   │   ├── export.js          # nama file, Blob, unduhan
│   │   ├── generator.js       # render inti (dipakai preview & ekspor) + generator batch/ZIP
│   │   ├── editor.js          # canvas preview, drag, zoom, keyboard
│   │   ├── participants.js    # parser TXT/CSV, tabel virtual, edit/hapus/duplikat
│   │   └── app.js             # state, penyimpanan, kontrol, alur generate
│   ├── fonts/                 # file .woff2 (Inter, Poppins, Montserrat, Playfair Display, Great Vibes)
│   └── vendor/jszip.min.js
└── README.md
```

Skrip dimuat sebagai script klasik (bukan ES module) sehingga juga berjalan bila `index.html` dibuka langsung dari disk, walau server lokal tetap disarankan.

## Font

Font **bundel** (ada file-nya): Poppins, Montserrat, Playfair Display, Great Vibes, Inter (subset *latin*: mencakup huruf Indonesia dan beraksen Eropa Barat; aksara non-Latin akan jatuh ke font cadangan). Hanya gaya Regular (400) dan Bold (700) yang disertakan; Great Vibes hanya Regular. Italic pada font tanpa file italic disintesis browser.

Font **sistem** (Arial, Georgia, Times New Roman) tidak dibundel; ketersediaannya dideteksi di perangkat. Jika tidak ada, aplikasi memberi tahu dan memakai font cadangan (hasil bisa berbeda antar komputer).

### Menambah font baru
1. Taruh file `.woff2` di `assets/fonts/`.
2. Tambah `@font-face` di `assets/css/style.css`:
   ```css
   @font-face{font-family:"Nama Font";font-style:normal;font-weight:400;font-display:swap;src:url("../fonts/nama-font-400.woff2") format("woff2")}
   ```
3. Daftarkan di array `CB.FONTS` pada `assets/js/generator.js`:
   ```js
   { id: 'Nama Font', label: 'Nama Font', stack: '"Nama Font", sans-serif', local: true, weights: [400] }
   ```
   `weights` harus sesuai gaya yang file-nya benar-benar ada. Sumber font gratis: Fontsource (`npm i @fontsource/<nama>`, ambil file `*-latin-*-normal.woff2`).

## Penyimpanan lokal
Hanya **pengaturan desain dan ekspor** serta nama proyek yang disimpan di LocalStorage (`certibulk.settings.v1`). **Gambar template dan daftar peserta tidak disimpan** — unggah ulang setelah memuat ulang halaman. Jika template berukuran beda dimuat, posisi & ukuran font diskalakan proporsional. Tombol *Reset pengaturan* ada di menu Pengaturan.

## Batasan teknis
- **Memori:** setiap sertifikat dirender di satu canvas yang dipakai ulang, lalu Blob-nya disimpan di ZIP; seluruh isi ZIP tetap berada di memori sampai selesai. Total memori ≈ jumlah peserta × ukuran file hasil. Template besar (mis. 4000×3000) dengan ribuan peserta dapat menghabiskan memori; kurangi resolusi, pilih JPG, atau bagi daftar peserta ke beberapa kelompok. Generator berhenti dengan pesan jelas jika 5 sertifikat berturut-turut gagal.
- **Ukuran canvas:** sisi maksimum ±16.384 px; Safari iOS membatasi area ±16 megapiksel. Template melebihi batas ditolak.
- **ZIP:** disimpan tanpa kompresi (PNG/JPG sudah terkompresi) agar cepat. Batas ukuran file tunggal mengikuti browser (praktisnya beberapa GB).
- **Sentuh:** canvas memakai `touch-action: none` agar drag teks halus; saat di-zoom besar gunakan input X/Y atau tombol Fit untuk bernavigasi.
- Format input template hanya PNG/JPG/JPEG. Teks satu baris (tanpa pembungkus baris otomatis).
- Penyimpanan hanya LocalStorage; mode privat/penyimpanan dinonaktifkan akan memunculkan peringatan.

## Pengujian

Pengujian yang **benar-benar dijalankan** (headless di Node 22 dengan `@napi-rs/canvas` + JSZip, memuat modul `export.js`, `generator.js`, `participants.js` yang sama dengan aplikasi) — 43 pemeriksaan lulus:

| Test | Hasil |
|---|---|
| 1. Template 1920×1080 → output tetap 1920×1080 | Lulus (rasio/resolusi diperiksa pada PNG hasil) |
| 2. Lima nama → lima file dengan nama benar | Lulus |
| 3. Posisi hasil ekspor sesuai X/Y (diukur dari piksel; toleransi ±6 px) | Lulus |
| 4. Font, warna, ukuran, alignment kiri/kanan/tengah, rotasi mengikuti pengaturan | Lulus |
| 5. Nama panjang: auto-fit, auto-fit mati, batas ukuran minimum, daftar nama yang tidak muat | Lulus |
| 6. Parser TXT & CSV (kutip, koma dalam field, kutip ganda, newline dalam kutip, titik-koma, BOM, kutip tak tertutup → error) | Lulus pada level parser |
| 7. Ekspor PNG & JPG (magic bytes, dapat didekode, kualitas JPG mengubah ukuran file) | Lulus |
| 8. ZIP dapat dibuka ulang dengan JSZip; isi & nama folder sesuai | Lulus |
| 9. Apostrof, tanda hubung, Unicode (Zoë, 李小龍), karakter terlarang, nama kembar | Lulus |
| 10. 300 peserta: progres dilaporkan, event loop tetap berjalan | Lulus (di Node; waktu tidak mewakili browser) |
| Tambahan: error per peserta tidak menggagalkan proses; start ganda ditolak; pembatalan | Lulus |
| 11. Template/peserta kosong | Logika validasi ada di kode (`issues()`), **belum diuji di browser** |
| 12. Tidak ada pengiriman ke server | Peninjauan kode: tidak ada `fetch`/XHR/WebSocket/beacon dan tidak ada URL eksternal di HTML/CSS/JS; **belum diverifikasi lewat network inspector browser** |
| 13. Offline | Semua aset dimuat dari `assets/` (diverifikasi lewat server statis lokal, semua 200); **belum diuji dengan jaringan benar-benar mati** |

**Belum diuji di browser sungguhan** (tidak ada browser di lingkungan pembuatan): tampilan/CSS, responsivitas mobile, drag-and-drop pointer & sentuh, drag-drop file, modal, toast, tabel virtual, tombol unduh (Blob URL), LocalStorage, dan pemuatan `@font-face` di browser. Mohon uji alur lengkap di Chrome/Firefox/Safari sebelum dipakai produksi.
