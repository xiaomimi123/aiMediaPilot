import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { materialType, decodeNote, createMaterial, updateMaterialNote, deleteMaterial } from '@/lib/film/materials';
import { createFakeDb } from '../../helpers/fake-db';

describe('materialType', () => {
  it('classifies images and videos, rejects others', () => {
    expect(materialType('a.PNG')).toBe('image');
    expect(materialType('a.webp')).toBe('image');
    expect(materialType('rec.mov')).toBe('video');
    expect(materialType('a.gif')).toBeNull();
  });
});

describe('decodeNote', () => {
  it('decodes a multi-line Chinese note from the header', () => {
    expect(decodeNote(encodeURIComponent('讲笨办法时放\n用 0:10～0:40'))).toBe('讲笨办法时放\n用 0:10～0:40');
  });
  it('returns empty for missing or malformed headers and caps the length', () => {
    expect(decodeNote(null)).toBe('');
    expect(decodeNote('%E4%')).toBe('');
    expect(decodeNote(encodeURIComponent('字'.repeat(300)))).toHaveLength(200);
  });
});

describe('material lifecycle', () => {
  it('creates, renames the temp file, edits the note and deletes file + row', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-mat-'));
    const temp = path.join(dir, 'upload-x.part');
    await fs.writeFile(temp, 'img');
    const { db, files } = createFakeDb();
    const { id } = await createMaterial(db, { projectId: 'p1', tempPath: temp, originalName: '截图.png', note: '放这', probe: { durationSec: null, width: 800, height: 600 } });
    const f = files.find((x) => x.id === id)!;
    expect(path.basename(f.path)).toMatch(/^material-[0-9a-f-]+\.png$/);
    expect(f.meta).toMatchObject({ note: '放这', originalName: '截图.png', mediaType: 'image', width: 800, height: 600 });
    await updateMaterialNote(db, 'p1', id, '改成讲冷知识时放');
    expect((files.find((x) => x.id === id)!.meta as { note: string }).note).toBe('改成讲冷知识时放');
    await deleteMaterial(db, 'p1', id);
    expect(files.find((x) => x.id === id)).toBeUndefined();
    await expect(fs.access(f.path)).rejects.toThrow();
  });
  it('refuses to touch a file that is not a material of this project', async () => {
    const { db } = createFakeDb({ files: [{ kind: 'raw_video', path: '/tmp/x' }] });
    const rawId = (await db.projectFile.findFirst({ where: { kind: 'raw_video' } }))!.id;
    await expect(deleteMaterial(db, 'p1', rawId)).rejects.toThrow('素材不存在');
  });
});
