"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, Star, ChevronLeft, ChevronRight, Quote } from "lucide-react";

type Testimonial = {
  id: string;
  name: string;
  text: string;
  rating: number;
  date: string;
};

type Props = {
  testimonials: Testimonial[];
  primaryColor: string;
  secondaryColor: string;
};

function AvatarCircle({ name, color }: { name: string; color: string }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 shadow-sm"
      style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
    >
      {initials}
    </div>
  );
}

export function TestimonialsSection({ testimonials, primaryColor, secondaryColor }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { threshold: 0.15 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (!testimonials || testimonials.length === 0) return null;

  const avgRating = testimonials.reduce((sum, t) => sum + t.rating, 0) / testimonials.length;

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const cardW = 320;
    el.scrollBy({ left: dir === "left" ? -cardW : cardW, behavior: "smooth" });
  };

  const useCarousel = testimonials.length > 2;

  return (
    <section
      ref={sectionRef}
      className="space-y-5"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: "opacity 0.6s ease-out, transform 0.6s ease-out",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center"
            style={{ background: `linear-gradient(135deg, ${primaryColor}18, ${secondaryColor}12)` }}
          >
            <MessageCircle className="w-4 h-4 sm:w-[18px] sm:h-[18px]" style={{ color: primaryColor }} />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-gray-800 tracking-tight">What Our Clients Say</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className="w-3 h-3"
                    fill={i < Math.round(avgRating) ? "#f59e0b" : "transparent"}
                    color={i < Math.round(avgRating) ? "#f59e0b" : "#d1d5db"}
                  />
                ))}
              </div>
              <span className="text-[10px] sm:text-[11px] text-gray-500 font-medium">
                {avgRating.toFixed(1)} from {testimonials.length} {testimonials.length === 1 ? "review" : "reviews"}
              </span>
            </div>
          </div>
        </div>
        {useCarousel && (
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={() => scroll("left")}
              disabled={!canScrollLeft}
              className="w-9 h-9 rounded-xl flex items-center justify-center border border-gray-200 bg-white hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] min-w-[44px]"
              aria-label="Previous testimonials"
            >
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>
            <button
              onClick={() => scroll("right")}
              disabled={!canScrollRight}
              className="w-9 h-9 rounded-xl flex items-center justify-center border border-gray-200 bg-white hover:bg-gray-50 transition-all disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] min-w-[44px]"
              aria-label="Next testimonials"
            >
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        )}
      </div>

      {useCarousel ? (
        <div className="relative">
          <div
            ref={scrollRef}
            className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory"
            style={{ scrollbarWidth: "none" }}
          >
            {testimonials.map((t, idx) => (
              <TestimonialCard
                key={t.id}
                testimonial={t}
                primaryColor={primaryColor}
                secondaryColor={secondaryColor}
                index={idx}
                visible={visible}
              />
            ))}
          </div>
          {canScrollLeft && (
            <div className="absolute left-0 top-0 bottom-2 w-12 bg-gradient-to-r from-white/80 to-transparent pointer-events-none" />
          )}
          {canScrollRight && (
            <div className="absolute right-0 top-0 bottom-2 w-12 bg-gradient-to-l from-white/80 to-transparent pointer-events-none" />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {testimonials.map((t, idx) => (
            <TestimonialCard
              key={t.id}
              testimonial={t}
              primaryColor={primaryColor}
              secondaryColor={secondaryColor}
              index={idx}
              visible={visible}
              gridMode
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TestimonialCard({
  testimonial: t,
  primaryColor,
  secondaryColor,
  index,
  visible,
  gridMode,
}: {
  testimonial: { id: string; name: string; text: string; rating: number; date: string };
  primaryColor: string;
  secondaryColor: string;
  index: number;
  visible: boolean;
  gridMode?: boolean;
}) {
  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("en-TT", { month: "short", year: "numeric" });
    } catch { return ""; }
  };

  return (
    <div
      className={`${gridMode ? "" : "flex-shrink-0 w-[260px] sm:w-[340px] snap-start"} rounded-2xl p-4 sm:p-5 space-y-3 sm:space-y-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg group relative`}
      style={{
        border: `1px solid ${primaryColor}0A`,
        background: `linear-gradient(135deg, ${primaryColor}03 0%, ${secondaryColor}02 100%)`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(12px)",
        transition: `opacity 0.5s ${0.1 + index * 0.08}s, transform 0.5s ${0.1 + index * 0.08}s, box-shadow 0.3s`,
      }}
    >
      <Quote
        className="w-8 h-8 absolute top-4 right-4 opacity-[0.08]"
        style={{ color: primaryColor }}
      />

      <div className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className="w-4 h-4 transition-transform duration-200 group-hover:scale-110"
            fill={i < t.rating ? "#f59e0b" : "transparent"}
            color={i < t.rating ? "#f59e0b" : "#d1d5db"}
          />
        ))}
      </div>

      <p className="text-sm text-gray-700 leading-relaxed line-clamp-4">
        &ldquo;{t.text}&rdquo;
      </p>

      <div className="flex items-center gap-3 pt-1">
        <AvatarCircle name={t.name} color={primaryColor} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 truncate">{t.name}</p>
          {t.date && (
            <p className="text-[11px] text-gray-400">{formatDate(t.date)}</p>
          )}
        </div>
      </div>
    </div>
  );
}
