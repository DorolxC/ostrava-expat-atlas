import { prepareEnvironment } from './environment.js';

const sample = new OffscreenCanvas(1, 1);
const foliage = new OffscreenCanvas(1, 1);

self.onmessage = async ({data: {layers, view, records, flow, fountains}}) => {
  const decoded = [];
  try {
    const images = await Promise.allSettled(layers.map(({blob}) => createImageBitmap(blob)));
    for (const image of images) if (image.status === 'fulfilled') decoded.push(image.value);
    if (decoded.length !== layers.length) throw new Error('Environmental tile decode failed');
    const scene = prepareEnvironment(view, records, flow, sample, foliage, (context) => {
      context.fillStyle = view.background;
      context.fillRect(0, 0, view.width, view.height);
      for (const [i, {rect, smooth}] of layers.entries()) {
        context.imageSmoothingEnabled = smooth;
        context.drawImage(decoded[i], ...rect);
      }
    }, fountains);
    const atlas = scene.trees.length ? foliage.transferToImageBitmap() : null;
    const buffers = [];
    if (atlas) buffers.push(atlas);
    if (scene.water) buffers.push(scene.water.spans.buffer);
    self.postMessage({...scene, atlas}, buffers);
  } catch {
    self.postMessage(null);
  } finally {
    for (const bitmap of decoded) bitmap.close();
  }
};
