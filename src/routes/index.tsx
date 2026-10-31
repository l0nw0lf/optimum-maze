import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Hud } from "@/game/Hud";
import { MazeCanvas } from "@/game/MazeCanvas";
import { useGame } from "@/game/store";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  useEffect(() => {
    const qa = new URLSearchParams(window.location.search).has("qa");
    if (qa) useGame.getState().startQa();
    else useGame.getState().hydrate();
  }, []);

  return (
    <main className="game-shell">
      <MazeCanvas />
      <Hud />
    </main>
  );
}
