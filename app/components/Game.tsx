import { useEffect, useRef, useState } from 'react';
import { Analytics } from "@vercel/analytics/react";

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

interface GameState {
  isPlaying: boolean;
  score: number;
  highScore: number;
  isImageLoaded: boolean;
}

interface Obstacle {
  x: number;
  gapY: number;
  gapHeight: number;
  peaks: number[];
}

interface GameLoop {
  plane: {
    x: number;
    y: number;
    velocity: number;
    rotation: number;
  };
  obstacles: Obstacle[];
  lastObstacleTime: number;
  bgOffset: number;
}

const Game = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const planeImageRef = useRef<HTMLImageElement | null>(null);
  const buildingImageRef = useRef<HTMLImageElement | null>(null);
  const explosionImageRef = useRef<HTMLImageElement | null>(null);
  const startSoundRef = useRef<HTMLAudioElement | null>(null);
  const crashSoundRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    score: 0,
    highScore: 0,
    isImageLoaded: false,
  });
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const gameLoopRef = useRef<GameLoop>({
    plane: { x: 100, y: 0, velocity: 0, rotation: 0 },
    obstacles: [],
    lastObstacleTime: 0,
    bgOffset: 0,
  });

  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [isMobile, setIsMobile] = useState(false);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;
        
        const aspectRatio = 4/3;
        let newWidth = containerWidth;
        let newHeight = containerWidth / aspectRatio;

        if (newHeight > containerHeight) {
          newHeight = containerHeight;
          newWidth = containerHeight * aspectRatio;
        }

        setCanvasSize({
          width: Math.min(800, newWidth),
          height: Math.min(600, newHeight)
        });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle touch/click events
  useEffect(() => {
    const handleTouch = () => {
      if (analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        dataArray.fill(255);
        analyser.getByteFrequencyData(dataArray);
      }
    };

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.addEventListener('touchstart', handleTouch);
      canvas.addEventListener('mousedown', handleTouch);
      return () => {
        canvas.removeEventListener('touchstart', handleTouch);
        canvas.removeEventListener('mousedown', handleTouch);
      };
    }
  }, [analyser]);

  // Handle visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && startSoundRef.current) {
        startSoundRef.current.pause();
      } else if (!document.hidden && startSoundRef.current && gameState.isPlaying) {
        startSoundRef.current.play().catch(error => {
          console.error('Error resuming sound:', error);
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [gameState.isPlaying]);

  // Load sounds
  useEffect(() => {
    const startSound = new Audio('/sound1.mp3');
    const crashSound = new Audio('/sound2.mp3');
    
    // Set different volumes for mobile and desktop
    if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      console.log('Mobile device detected - crash sound only');
      crashSound.volume = 0.005;  // 0.5% volume for mobile
      // Don't set up background music for mobile
      startSoundRef.current = null;
    } else {
      console.log('Desktop detected - setting normal volume');
      startSound.volume = 0.1;   // 10% volume for web
      crashSound.volume = 0.4;   // 40% volume for web
      startSound.loop = true;
      startSoundRef.current = startSound;
    }
    
    startSound.preload = 'auto';
    crashSound.preload = 'auto';
    crashSoundRef.current = crashSound;

    return () => {
      if (startSoundRef.current) {
        startSoundRef.current.pause();
        startSoundRef.current.currentTime = 0;
      }
      startSoundRef.current = null;
      crashSoundRef.current = null;
    };
  }, []);

  // Setup audio context with improved sensitivity
  useEffect(() => {
    let mounted = true;
    
    const setupAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });
        
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const source = context.createMediaStreamSource(stream);
        const analyserNode = context.createAnalyser();
        
        // Adjust these values for better sensitivity
        analyserNode.fftSize = 1024;  // Increased for better resolution
        analyserNode.smoothingTimeConstant = 0.6;  // Reduced for faster response
        
        source.connect(analyserNode);
        
        if (mounted) {
          setAudioContext(context);
          setAnalyser(analyserNode);
          setMediaStream(stream);

          if (context.state === 'suspended') {
            await context.resume();
          }
        }
      } catch (error) {
        console.error('Error accessing microphone:', error);
      }
    };

    setupAudio();

    return () => {
      mounted = false;
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
      if (audioContext) {
        audioContext.close();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Load images with proper cleanup
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const planeImg = document.createElement('img');
    const buildingImg = document.createElement('img');
    const explosionImg = document.createElement('img');
    
    const cleanup = () => {
      planeImg.onload = null;
      buildingImg.onload = null;
      explosionImg.onload = null;
      
      if (planeImageRef.current) {
        planeImageRef.current.onload = null;
      }
      if (buildingImageRef.current) {
        buildingImageRef.current.onload = null;
      }
      if (explosionImageRef.current) {
        explosionImageRef.current.onload = null;
      }
    };

    planeImg.onload = () => {
      setGameState(prev => ({ ...prev, isImageLoaded: true }));
    };

    planeImg.src = '/plane.png';
    buildingImg.src = '/build.jpg';
    explosionImg.src = '/explosion.gif';

    planeImageRef.current = planeImg;
    buildingImageRef.current = buildingImg;
    explosionImageRef.current = explosionImg;

    return cleanup;
  }, []); // Empty dependency array since we only want to load images once

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        ('maxTouchPoints' in navigator && navigator.maxTouchPoints > 0)
      );
    };
    checkMobile();
  }, []);

  // Function to generate building heights
  const generateBuilding = (): number[] => {
    const heights = [];
    const baseHeight = Math.random() * 150 + 100;
    heights.push(baseHeight);
    return heights;
  };

  // Update the drawPlane function to use planeImageRef
  const drawPlane = (ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    
    // Draw the plane image centered at x,y
    const width = 100;
    const height = 60;
    if (planeImageRef.current && gameState.isImageLoaded) {
      ctx.drawImage(planeImageRef.current, -width/2, -height/2, width, height);
    } else {
      // Fallback if image hasn't loaded yet
      ctx.fillStyle = '#E8E8E8';
      ctx.fillRect(-20, -8, 40, 16);
    }
    
    ctx.restore();
  };

  // Function to draw a building obstacle
  const drawBuilding = (ctx: CanvasRenderingContext2D, obstacle: Obstacle, canvasHeight: number) => {
    const { x, gapY, gapHeight } = obstacle;
    
    if (buildingImageRef.current) {
      // Draw top building
      const topHeight = gapY;
      ctx.drawImage(buildingImageRef.current, 
        x, 0, // destination x, y
        150, topHeight // destination width, height
      );
      
      // Draw bottom building
      const bottomY = gapY + gapHeight;
      const bottomHeight = canvasHeight - bottomY;
      ctx.drawImage(buildingImageRef.current,
        x, bottomY, // destination x, y
        150, bottomHeight // destination width, height
      );
    } else {
      // Fallback if image hasn't loaded
      ctx.fillStyle = '#4CAF50';
      
      // Draw top building
      ctx.fillRect(x, 0, 150, gapY);
      
      // Draw bottom building
      ctx.fillRect(x, gapY + gapHeight, 150, canvasHeight - (gapY + gapHeight));
    }
  };

  const startGame = async () => {
    try {
      // Play start sound immediately for non-mobile
      if (startSoundRef.current && !(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent))) {
        startSoundRef.current.currentTime = 0;
        startSoundRef.current.volume = 0.1; // 10% volume
        await startSoundRef.current.play().catch(console.error);
      }

      // Initialize audio if not already done
      if (!analyser) {
        console.log('Initializing audio...');
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } 
        });

        const context = new (window.AudioContext || window.webkitAudioContext)();
        const source = context.createMediaStreamSource(stream);
        const analyserNode = context.createAnalyser();
        
        analyserNode.fftSize = 1024;
        analyserNode.smoothingTimeConstant = 0.6;
        
        source.connect(analyserNode);
        
        setAudioContext(context);
        setAnalyser(analyserNode);
        setMediaStream(stream);

        if (context.state === 'suspended') {
          await context.resume();
        }
      }

      // Reset game state
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        
        // Set initial game state
        setGameState(prev => ({ 
          ...prev, 
          isPlaying: true, 
          score: 0 
        }));

        gameLoopRef.current = {
          plane: { 
            x: 100, 
            y: canvas.height / 2, 
            velocity: 0, 
            rotation: 0 
          },
          obstacles: [],
          lastObstacleTime: Date.now(),
          bgOffset: 0,
        };

        // Create first obstacle
        const gap = 250;
        const gapPosition = Math.random() * (canvas.height - gap - 100) + 50;
        gameLoopRef.current.obstacles.push({
          x: canvas.width,
          gapY: gapPosition,
          gapHeight: gap,
          peaks: generateBuilding(),
        });

        // Start game loop immediately
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        animationFrameRef.current = requestAnimationFrame(gameLoop);
      }
    } catch (error) {
      console.error('Error starting game:', error);
      alert('Please allow microphone access to play the game. If denied, please refresh and try again.');
    }
  };

  // Add debug info display
  useEffect(() => {
    if (gameState.isPlaying) {
      console.log('Game started successfully');
      console.log('Audio context state:', audioContext?.state);
      console.log('Analyser node:', analyser ? 'created' : 'not created');
      console.log('Media stream:', mediaStream ? 'active' : 'not active');
    }
  }, [gameState.isPlaying, audioContext, analyser, mediaStream]);

  const gameLoop = () => {
    animationFrameRef.current = requestAnimationFrame(gameLoop);

    if (!canvasRef.current || !analyser) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#87CEEB';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const game = gameLoopRef.current;
      let collision = false;
      
      // Check for boundary collisions first
      const planeHitbox = {
        x: game.plane.x - 40,
        y: game.plane.y - 20,
        width: 80,
        height: 40
      };

      // Check if plane hits top or bottom of screen
      if (planeHitbox.y <= 0 || planeHitbox.y + planeHitbox.height >= canvas.height) {
        collision = true;
        // Draw collision point
        ctx.strokeStyle = 'red';
        ctx.beginPath();
        ctx.arc(game.plane.x, planeHitbox.y <= 0 ? planeHitbox.y : planeHitbox.y + planeHitbox.height, 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Only check obstacle collisions if we haven't hit boundaries
      if (!collision) {
        game.obstacles = game.obstacles.filter(obstacle => {
          obstacle.x -= 3;
          
          drawBuilding(ctx, obstacle, canvas.height);

          if (planeHitbox.x + planeHitbox.width > obstacle.x && 
              planeHitbox.x < obstacle.x + 50) {
            
            if (planeHitbox.y < obstacle.gapY) {
              collision = true;
              ctx.strokeStyle = 'red';
              ctx.beginPath();
              ctx.arc(game.plane.x, planeHitbox.y, 5, 0, Math.PI * 2);
              ctx.stroke();
            }
            
            if (planeHitbox.y + planeHitbox.height > obstacle.gapY + obstacle.gapHeight) {
              collision = true;
              ctx.strokeStyle = 'red';
              ctx.beginPath();
              ctx.arc(game.plane.x, planeHitbox.y + planeHitbox.height, 5, 0, Math.PI * 2);
              ctx.stroke();
            }
          }

          return obstacle.x > -50;
        });
      }

      // Draw plane after collision checks
      drawPlane(ctx, game.plane.x, game.plane.y, game.plane.rotation);

      // Get audio data with improved sensitivity
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate volume with better sensitivity
      const rawVolume = dataArray.reduce((a, b) => a + b) / dataArray.length;
      const noiseFloor = 10;  // Reduced noise floor
      const normalizedVolume = Math.max(0, rawVolume - noiseFloor);
      const volume = normalizedVolume * 0.8;  // Increased multiplier for more lift
      
      // Update plane position with more responsive controls
      const gravity = 0.25;  // Reduced gravity
      const lift = Math.max(0, (volume - 3) * 0.2);  // Adjusted lift calculation
      
      game.plane.velocity += gravity;
      game.plane.velocity -= lift;
      game.plane.velocity *= 0.97;  // Slightly reduced dampening
      game.plane.velocity = Math.max(-6, Math.min(6, game.plane.velocity));  // Increased velocity range
      game.plane.y += game.plane.velocity;
      game.plane.y = Math.max(20, Math.min(canvas.height - 20, game.plane.y));

      // Smoother rotation based on velocity
      const targetRotation = game.plane.velocity * 0.15;
      game.plane.rotation += (targetRotation - game.plane.rotation) * 0.1; // More gradual rotation

      // Update background
      game.bgOffset = (game.bgOffset + 2) % canvas.width;

      // Draw clouds
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      for (let i = 0; i < 5; i++) {
        const x = ((i * 200) - game.bgOffset) % canvas.width;
        drawCloud(ctx, x, 50 + i * 30);
      }

      // Generate and update obstacles
      const now = Date.now();
      if (now - game.lastObstacleTime > 2000) {
        const gap = 250; // Wider gap
        const gapPosition = Math.random() * (canvas.height - gap - 100) + 50;
        game.obstacles.push({
          x: canvas.width,
          gapY: gapPosition,
          gapHeight: gap,
          peaks: generateBuilding(),
        });
        game.lastObstacleTime = now;
      }

      // Debug info (minimal)
      ctx.font = '12px monospace';
      ctx.fillStyle = 'white';
      ctx.fillText(`Volume: ${Math.round(volume)}`, 10, 20);

      if (collision) {
        // Play crash sound
        if (crashSoundRef.current) {
          crashSoundRef.current.currentTime = 0;
          crashSoundRef.current.play().catch(error => {
            console.error('Error playing crash sound:', error);
          });
        }

        // Draw explosion at collision point
        if (explosionImageRef.current) {
          const explosionSize = 150;
          ctx.drawImage(
            explosionImageRef.current,
            game.plane.x - explosionSize/2,
            game.plane.y - explosionSize/2,
            explosionSize,
            explosionSize
          );
        }

        // Visual feedback for collision
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, canvas.width, canvas.height);
        
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = undefined;
        }

        // Short delay before game over
        setTimeout(() => {
          gameOver();
        }, 750);
        return;
      }

      // Update score
      setGameState(prev => ({ ...prev, score: prev.score + 1 }));

    } catch (error) {
      console.error('Error in game loop:', error);
    }
  };

  // Function to draw a simple cloud
  const drawCloud = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.arc(x + 15, y - 10, 15, 0, Math.PI * 2);
    ctx.arc(x + 15, y + 10, 15, 0, Math.PI * 2);
    ctx.arc(x + 30, y, 20, 0, Math.PI * 2);
    ctx.fill();
  };

  const gameOver = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    setGameState(prev => ({
      ...prev,
      isPlaying: false,
      highScore: Math.max(prev.highScore, prev.score),
    }));
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-screen flex flex-col items-center justify-center bg-gradient-to-b from-[#1a1a1a] to-[#2d2d2d] p-4"
    >
      <Analytics />
      <div className="absolute top-4 left-4 text-white font-[Press_Start_2P] text-xl sm:text-2xl z-10">
        <p className="mb-2">SCORE: {gameState.score}</p>
        <p>HIGH: {gameState.highScore}</p>
      </div>
      
      {!gameState.isPlaying && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 bg-black/50 backdrop-blur-sm">
          {gameState.score === 0 ? (
            <>
              <h1 className="text-4xl sm:text-6xl md:text-7xl font-[Press_Start_2P] text-white mb-8 animate-pulse">
                VOICE FLIGHT
              </h1>
              
              <div className="relative mb-12">
                {planeImageRef.current && (
                  <img 
                    src={planeImageRef.current.src} 
                    alt="Plane"
                    className="w-32 h-20 object-contain animate-bounce"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="text-center mb-8">
              <h2 className="text-4xl sm:text-5xl font-[Press_Start_2P] text-white mb-6 animate-pulse">GAME OVER</h2>
              <div className="space-y-4 mb-8">
                <p className="text-2xl font-[Press_Start_2P] text-[#4CAF50]">SCORE: {gameState.score}</p>
                <p className="text-xl font-[Press_Start_2P] text-white/70">BEST: {gameState.highScore}</p>
              </div>
              {planeImageRef.current && (
                <img 
                  src={planeImageRef.current.src} 
                  alt="Plane"
                  className="w-32 h-20 object-contain mx-auto mb-8 animate-bounce"
                />
              )}
            </div>
          )}

          <button
            onClick={startGame}
            className="relative px-8 py-4 bg-gradient-to-r from-[#4CAF50] to-[#45a049] text-white 
                     rounded-lg font-[Press_Start_2P] text-xl sm:text-2xl shadow-[0_0_20px_rgba(76,175,80,0.5)]
                     hover:shadow-[0_0_30px_rgba(76,175,80,0.7)] hover:scale-105
                     transition-all duration-300 transform active:scale-95 touch-none
                     border-2 border-[#45a049] animate-pulse"
          >
            {gameState.score > 0 ? 'PLAY AGAIN' : 'START GAME'}
          </button>

          <p className="mt-8 font-[Press_Start_2P] text-white text-base sm:text-lg opacity-75">
            {isMobile ? 'MAKE ANY NOISE TO FLY' : 'MAKE ANY NOISE TO FLY'}
          </p>
        </div>
      )}

      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className="border-4 border-[#4CAF50] rounded-lg shadow-[0_0_20px_rgba(76,175,80,0.3)] max-w-full max-h-full"
        style={{
          width: `${canvasSize.width}px`,
          height: `${canvasSize.height}px`
        }}
      />

      <footer className="absolute bottom-4 text-center text-sm">
        <p className="text-white/70">
          Made with ❤️ by{" "}
          <a
            href="https://github.com/1sankalp"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#4CAF50] hover:text-[#45a049] font-semibold transition-colors"
          >
            Sankalp
          </a>
        </p>
      </footer>
    </div>
  );
};

export default Game; 