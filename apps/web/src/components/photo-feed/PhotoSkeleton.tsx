// web/src/components/photo-feed/PhotoSkeleton.tsx
export const PhotoSkeleton = () => (
    <div className="break-inside-avoid rounded-2xl border border-white/5 bg-card overflow-hidden">
        <div className="relative w-full aspect-4/5 bg-zinc-900 animate-pulse">
            {/* Reflejo de luz animado para dar profundidad */}
            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/5 to-transparent
                            -translate-x-full animate-[shimmer_2s_infinite]" />
        </div>
    </div>
);