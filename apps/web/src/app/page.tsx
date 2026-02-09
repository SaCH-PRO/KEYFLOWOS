"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Zap, Calendar, DollarSign, Users, ArrowRight, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-[#0a0807] text-white overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 via-transparent to-teal-500/10" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-orange-500/20 to-transparent blur-3xl rounded-full" />
      
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-16">
        <nav className="flex items-center justify-between mb-20">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold">KEYFLOWOS</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-gray-400 hover:text-white transition-colors">
              Pricing
            </Link>
            <Link href="/auth/login" className="text-gray-400 hover:text-white transition-colors">
              Log in
            </Link>
            <Link 
              href="/auth/signup" 
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 transition-colors font-medium"
            >
              Start Free
            </Link>
          </div>
        </nav>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm font-medium mb-6">
            <Sparkles className="w-4 h-4" />
            AI-Powered Business Autopilot
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            Run your business on
            <span className="block bg-gradient-to-r from-orange-400 to-teal-400 bg-clip-text text-transparent">
              autopilot
            </span>
          </h1>
          
          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
            KeyFlowOS handles 80-90% of your daily operations automatically. 
            Spend less than 5 minutes a day managing your business.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link 
              href="/auth/signup" 
              className="group px-8 py-4 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 font-semibold text-lg transition-all flex items-center gap-2"
            >
              Get Started Free
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link 
              href="/app" 
              className="px-8 py-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 font-semibold text-lg transition-all"
            >
              View Demo
            </Link>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-20"
        >
          {[
            { icon: Zap, title: "Task Automation", desc: "AI handles your daily tasks" },
            { icon: Calendar, title: "Smart Scheduling", desc: "Bookings on autopilot" },
            { icon: DollarSign, title: "Invoice & Payments", desc: "Get paid automatically" },
            { icon: Users, title: "CRM Intelligence", desc: "Know your customers" },
          ].map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3 + i * 0.1 }}
              className="p-6 rounded-2xl bg-white/5 border border-white/10 hover:border-orange-500/30 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-teal-500/20 flex items-center justify-center mb-4">
                <feature.icon className="w-6 h-6 text-orange-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
              <p className="text-gray-500 text-sm">{feature.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="text-center"
        >
          <p className="text-gray-600 text-sm">
            Trusted by service businesses worldwide
          </p>
        </motion.div>
      </div>
    </div>
  );
}
