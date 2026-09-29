import { useRef, useState } from 'react';
import { friendlyError, photoUrl, supabase } from './lib/supabase';
import { compressImage } from './lib/util';
import { Button } from './ui';

/** Upload a photo to Supabase Storage (compressed in the browser first). */
export function PhotoPicker({ value, folder, onChange }: { value: string | null; folder: string; onChange: (path: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = photoUrl(value);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await compressImage(file);
      const name = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
      const { error } = await supabase.storage.from('catalogue').upload(name, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
      if (error) throw error;
      onChange(`catalogue/${name}`);
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : friendlyError(e as { message: string }));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="grid h-24 w-36 place-items-center overflow-hidden rounded-xl bg-slate-100 text-center text-xs text-slate-500 ring-1 ring-slate-200">
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : value ? 'Photo from the original website' : 'No photo'}
      </div>
      <div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} aria-label="Choose a photo" />
        <Button type="button" variant="secondary" busy={busy} onClick={() => input.current?.click()}>{value ? 'Replace photo' : 'Upload photo'}</Button>
        <p className="mt-1 text-xs text-slate-500">JPG, PNG or WebP. It’s resized automatically.</p>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
