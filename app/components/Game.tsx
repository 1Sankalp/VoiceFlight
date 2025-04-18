import { useEffect, useRef, useState } from 'react';

interface GameState {
  isPlaying: boolean;
  score: number;
  highScore: number;
}

const Game = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>({
    isPlaying: false,
    score: 0,
    highScore: 0,
  });
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const animationFrameRef = useRef<number>();
  const gameLoopRef = useRef<any>({
    plane: { y: 0, velocity: 0 },
    obstacles: [],
    lastObstacleTime: 0,
  });

  useEffect(() => {
    const setupAudio = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyserNode = context.createAnalyser();
        analyserNode.fftSize = 256;
        source.connect(analyserNode);
        
        setAudioContext(context);
        setAnalyser(analyserNode);
        setMediaStream(stream);
      } catch (error) {
        console.error('Error accessing microphone:', error);
      }
    };

    setupAudio();

    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
      if (audioContext) {
        audioContext.close();
      }
    };
  }, []);

  const startGame = () => {
    if (!canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset game state
    gameLoopRef.current = {
      plane: { y: canvas.height / 2, velocity: 0 },
      obstacles: [],
      lastObstacleTime: 0,
    };

    setGameState(prev => ({ ...prev, isPlaying: true, score: 0 }));
    gameLoop();
  };

  const gameLoop = () => {
    if (!canvasRef.current || !analyser) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get audio data
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    const volume = dataArray.reduce((a, b) => a + b) / dataArray.length;

    // Update plane position based on volume
    const game = gameLoopRef.current;
    game.plane.velocity += (volume - 128) * 0.1;
    game.plane.y += game.plane.velocity;
    game.plane.y = Math.max(0, Math.min(canvas.height, game.plane.y));

    // Generate obstacles
    if (Date.now() - game.lastObstacleTime > 2000) {
      const gap = 150;
      const gapPosition = Math.random() * (canvas.height - gap);
      game.obstacles.push({
        x: canvas.width,
        gapY: gapPosition,
        gapHeight: gap,
      });
      game.lastObstacleTime = Date.now();
    }

    // Update obstacles
    game.obstacles = game.obstacles.filter(obstacle => {
      obstacle.x -= 5;
      return obstacle.x > -50;
    });

    // Check collisions
    const planeRadius = 20;
    const collision = game.obstacles.some(obstacle => {
      if (
        game.plane.x + planeRadius > obstacle.x &&
        game.plane.x - planeRadius < obstacle.x + 50
      ) {
        return (
          game.plane.y - planeRadius < obstacle.gapY ||
          game.plane.y + planeRadius > obstacle.gapY + obstacle.gapHeight
        );
      }
      return false;
    });

    if (collision) {
      gameOver();
      return;
    }

    // Draw game
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw plane
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(100, game.plane.y, planeRadius, 0, Math.PI * 2);
    ctx.fill();

    // Draw obstacles
    ctx.fillStyle = '#00ff00';
    game.obstacles.forEach(obstacle => {
      ctx.fillRect(obstacle.x, 0, 50, obstacle.gapY);
      ctx.fillRect(
        obstacle.x,
        obstacle.gapY + obstacle.gapHeight,
        50,
        canvas.height - (obstacle.gapY + obstacle.gapHeight)
      );
    });

    // Update score
    setGameState(prev => ({ ...prev, score: prev.score + 1 }));

    animationFrameRef.current = requestAnimationFrame(gameLoop);
  };

  const gameOver = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setGameState(prev => ({
      ...prev,
      isPlaying: false,
      highScore: Math.max(prev.highScore, prev.score),
    }));
  };

  return (
    <div className="relative w-full h-screen flex flex-col items-center justify-center bg-gray-900">
      <div className="absolute top-4 left-4 text-white">
        <p>Score: {gameState.score}</p>
        <p>High Score: {gameState.highScore}</p>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="border-4 border-white rounded-lg"
      />
      {!gameState.isPlaying && (
        <button
          onClick={startGame}
          className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          {gameState.score > 0 ? 'Play Again' : 'Start Game'}
        </button>
      )}
    </div>
  );
};

export default Game; 