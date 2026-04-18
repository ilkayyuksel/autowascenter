import { useEffect, useState } from "react";
import { Star, Quote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Review = {
  id: string;
  customer_name: string;
  rating: number;
  content: string;
};

export function Testimonials() {
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    supabase
      .from("reviews")
      .select("id,customer_name,rating,content")
      .eq("approved", true)
      .order("created_at", { ascending: false })
      .limit(6)
      .then(({ data }) => data && setReviews(data));
  }, []);

  if (!reviews.length) return null;

  return (
    <section className="py-20 sm:py-28 bg-gradient-subtle">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider">Reviews</p>
          <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Wat onze klanten zeggen</h2>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((r) => (
            <article key={r.id} className="relative rounded-2xl bg-card border border-border p-6 shadow-soft">
              <Quote className="absolute top-5 right-5 h-8 w-8 text-accent" />
              <div className="flex gap-0.5 mb-3">
                {[...Array(r.rating)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-primary text-primary" />
                ))}
              </div>
              <p className="text-foreground/85 leading-relaxed">"{r.content}"</p>
              <p className="mt-4 text-sm font-semibold">{r.customer_name}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
