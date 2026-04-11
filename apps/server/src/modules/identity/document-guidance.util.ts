export interface DocumentRecommendation {
  category: 'Legal' | 'Financial' | 'Creative' | 'Constitutional';
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export function generateDocumentRecommendations(
  industry: string,
  businessStage: string,
  country: string,
  city: string,
): DocumentRecommendation[] {
  const recs: DocumentRecommendation[] = [];
  const ind = industry.toLowerCase();
  const stage = businessStage.toLowerCase();

  recs.push({
    category: 'Legal',
    title: 'Business Registration Certificate',
    description: 'Ensure your business is properly registered with the relevant government authority.',
    priority: 'high',
  });

  recs.push({
    category: 'Legal',
    title: 'Terms of Service',
    description: 'Define the rules and guidelines for using your products or services.',
    priority: 'high',
  });

  recs.push({
    category: 'Legal',
    title: 'Privacy Policy',
    description: 'Required if you collect any personal data from customers or website visitors.',
    priority: 'high',
  });

  recs.push({
    category: 'Financial',
    title: 'Business Bank Account',
    description: 'Separate personal and business finances with a dedicated business account.',
    priority: 'high',
  });

  if (stage === 'startup' || stage === 'idea') {
    recs.push({
      category: 'Financial',
      title: 'Business Plan & Financial Projections',
      description: 'Essential for securing funding and guiding your early-stage growth strategy.',
      priority: 'high',
    });
  }

  if (stage === 'growth' || stage === 'scaling') {
    recs.push({
      category: 'Financial',
      title: 'Financial Audit Report',
      description: 'Regular financial audits help maintain investor confidence and regulatory compliance.',
      priority: 'medium',
    });
  }

  if (ind.includes('health') || ind.includes('food') || ind.includes('wellness') || ind.includes('fitness')) {
    recs.push({
      category: 'Constitutional',
      title: 'Health & Safety Compliance Plan',
      description: 'Your industry typically requires health and safety certifications and regular inspections.',
      priority: 'high',
    });
    recs.push({
      category: 'Legal',
      title: 'Professional Liability Insurance',
      description: 'Protect your business against claims of negligence or inadequate service.',
      priority: 'medium',
    });
  }

  if (ind.includes('tech') || ind.includes('software') || ind.includes('digital') || ind.includes('saas')) {
    recs.push({
      category: 'Legal',
      title: 'Intellectual Property Protection',
      description: 'Consider patents, trademarks, or copyrights for your digital products and brand.',
      priority: 'medium',
    });
    recs.push({
      category: 'Constitutional',
      title: 'Data Protection Compliance',
      description: 'Ensure compliance with data protection regulations (GDPR, CCPA, etc.).',
      priority: 'high',
    });
  }

  if (ind.includes('retail') || ind.includes('ecommerce') || ind.includes('commerce')) {
    recs.push({
      category: 'Legal',
      title: 'Return & Refund Policy',
      description: 'Clear return policies protect both you and your customers.',
      priority: 'medium',
    });
    recs.push({
      category: 'Constitutional',
      title: 'Consumer Protection Compliance',
      description: 'Ensure your business meets local consumer protection regulations.',
      priority: 'medium',
    });
  }

  if (ind.includes('creative') || ind.includes('design') || ind.includes('media') || ind.includes('art') || ind.includes('photography')) {
    recs.push({
      category: 'Creative',
      title: 'Copyright & Licensing Agreements',
      description: 'Protect your creative works and clarify usage rights with clients.',
      priority: 'high',
    });
    recs.push({
      category: 'Creative',
      title: 'Portfolio & Brand Guidelines',
      description: 'Document your brand standards and showcase your best work professionally.',
      priority: 'medium',
    });
  }

  if (ind.includes('consulting') || ind.includes('service') || ind.includes('agency')) {
    recs.push({
      category: 'Legal',
      title: 'Client Service Agreement',
      description: 'A detailed contract outlining scope, deliverables, timelines, and payment terms.',
      priority: 'high',
    });
    recs.push({
      category: 'Legal',
      title: 'Non-Disclosure Agreement (NDA)',
      description: 'Protect confidential information shared between you and your clients.',
      priority: 'medium',
    });
  }

  recs.push({
    category: 'Financial',
    title: 'Tax Registration & Compliance',
    description: country ? `Ensure you are registered for all applicable taxes in ${country}.` : 'Register for applicable business taxes in your jurisdiction.',
    priority: 'high',
  });

  recs.push({
    category: 'Constitutional',
    title: 'Business License & Permits',
    description: city ? `Check ${city} local requirements for business operating licenses and permits.` : 'Verify local licensing and permit requirements for your business type.',
    priority: 'medium',
  });

  recs.push({
    category: 'Creative',
    title: 'Brand Identity Package',
    description: 'Logo, color palette, typography, and brand voice guidelines for consistent marketing.',
    priority: 'low',
  });

  return recs;
}
