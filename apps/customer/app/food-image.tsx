type FoodImageProps = { image?: string | null; name: string; priority?: boolean };

/** Render demo cutouts and user uploads without stretching or cropping. */
export function FoodImage({image, name, priority = false}: FoodImageProps) {
  const match = /^atlas:(\d+)$/.exec(image || '');
  const index = match ? Number(match[1]) : -1;
  const demoImage = /^\/images\/products\/(?:[0-9]|[12][0-9])\.webp$/.test(image || '');
  const src = index >= 0 && index < 30 ? `/images/products/${index}.webp` : demoImage || image?.startsWith('/uploads/') ? image : null;
  return <div className="food-photo">{src ? <img src={src} alt={name} loading={priority ? 'eager' : 'lazy'} decoding="async"/> : <span className="food-photo-empty">Sem fotografia</span>}</div>;
}
