"use client";

import { MessageCircle, Star } from "lucide-react";

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

export function TestimonialsSection({ testimonials, primaryColor, secondaryColor }: Props) {
  if (!testimonials || testimonials.length === 0) return null;

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${primaryColor}15` }}
        >
          <MessageCircle className="w-4 h-4" style={{ color: primaryColor }} />
        </div>
        <h3 className="text-lg font-semibold text-gray-700">What Our Clients Say</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {testimonials.map((t, idx) => (
          <div
            key={t.id}
            className="group rounded-2xl p-5 space-y-3 transition-all duration-300 hover:-translate-y-0.5"
            style={{
              border: `1px solid ${primaryColor}12`,
              background: `${primaryColor}04`,
            }}
          >
            <div className="flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className="w-4 h-4 transition-transform group-hover:scale-110"
                  fill={i < t.rating ? secondaryColor : "transparent"}
                  color={i < t.rating ? secondaryColor : "#ffffff20"}
                />
              ))}
            </div>
            <p className="text-sm text-gray-900/55 italic leading-relaxed">
              &ldquo;{t.text}&rdquo;
            </p>
            <p className="text-xs text-gray-900/35 font-medium">&mdash; {t.name}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
