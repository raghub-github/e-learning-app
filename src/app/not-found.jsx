"use client";
import { useCallback } from "react";
import Particles from "react-tsparticles";
import { loadSlim } from "tsparticles-slim";
import { motion } from "framer-motion";

export default function NotFound() {
  // Callback to load 3D particles config
  const particlesInit = useCallback(async (engine) => {
    await loadSlim(engine);
  }, []);

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-gray-900 text-white overflow-hidden">
      {/* 3D Particle Animated Background */}
      <Particles
        id="tsparticles"
        init={particlesInit}
        options={{
          fullScreen: { enable: false },
          background: { color: "#111827" },
          particles: {
            number: { value: 80 },
            color: { value: "#60a5fa" },
            shape: { type: "circle" },
            opacity: { value: 0.55 },
            size: { value: 7, random: true },
            move: {
              enable: true,
              speed: 2,
              direction: "none",
              outModes: "bounce",
            },
            links: {
              enable: true,
              color: "#3b82f6",
              distance: 100,
              opacity: 0.3,
              width: 2,
            },
          },
        }}
        className="absolute inset-0 w-full h-full z-0"
      />

      {/* Main Content With Animation */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: "anticipate" }}
        className="relative z-10 flex flex-col items-center text-center space-y-6 px-6 py-12 bg-gray-800/80 rounded-3xl shadow-2xl max-w-lg"
      >
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.7, type: "spring" }}
          className="text-7xl sm:text-8xl font-black bg-gradient-to-br from-blue-400 via-purple-500 to-pink-400 bg-clip-text text-transparent animate-pulse select-none"
        >
          404
        </motion.div>
        <motion.h1
          initial={{ x: 30, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.7 }}
          className="text-3xl sm:text-4xl font-bold"
        >
          Page Not Found
        </motion.h1>
        <p className="text-gray-300 max-w-xs mx-auto">
          Sorry, this page doesn’t exist or has been moved.
        </p>
        <div className="flex flex-col gap-4 w-full sm:flex-row justify-center mt-4">
          <a
            href="/"
            className="inline-block w-full px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 via-purple-600 to-pink-500 text-white font-semibold shadow-lg hover:brightness-125 transition duration-200"
          >
            Go Home
          </a>
        </div>
      </motion.div>
    </div>
  );
}
