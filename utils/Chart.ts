import { Chart, ChartConfiguration, registerables } from "chart.js";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import annotationPlugin from "chartjs-plugin-annotation";
import datalabels from "chartjs-plugin-datalabels";
import fs from "fs";

Chart.register(annotationPlugin, datalabels);

export const generateChart = async (result: any[], totalVotes: number) => {
  const candidates = [];
  const scores: { [key: string]: number[] } = {
    Excellent: [],
    VGood: [],
    Good: [],
    Medium: [],
    Bad: [],
    VBad: [],
    Awful: [],
  };

  for (let i = 0; i < result.length; i++) {
    candidates.push(`Candidate ${i + 1}`);
    scores.Excellent.push(result[i][0]);
    scores.VGood.push(result[i][1]);
    scores.Good.push(result[i][2]);
    scores.Medium.push(result[i][3]);
    scores.Bad.push(result[i][4]);
    scores.VBad.push(result[i][5]);
    scores.Awful.push(result[i][6]);
  }

  const percentageScores = Object.entries(scores).map(([grade, votes]) => ({
    label: grade,
    data: votes.map((vote) => (vote / totalVotes) * 100),
  }));

  const colors = [
    "#1B5E20", // Excellent - Deep Forest Green
    "#4CAF50", // Very Good - Dark Green
    "#9E9D24", // Good - Darker Yellow-Green
    "#FDD835", // Medium - Rich Yellow
    "#FB8C00", // Bad - Darker Orange
    "#E53935", // Very Bad - True Red
    "#B71C1C", // Awful - Deeper Dark Red
  ];

  // Reverse datasets so "Awful" is drawn first (bottom) and "Excellent" last (top)
  percentageScores.reverse();
  colors.reverse(); // Reverse colors too, so they still match the correct dataset

  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: 800,
    height: 600,
    backgroundColour: "white",
  });

  const configuration: ChartConfiguration = {
    type: "bar",
    data: {
      labels: candidates,
      datasets: percentageScores.map((entry, index) => ({
        label: entry.label,
        data: entry.data,
        backgroundColor: colors[index],
        stack: "stack1",
      })),
    },
    options: {
      responsive: false,
      scales: {
        x: { stacked: true },
        y: {
          stacked: true,
          min: 0,
          max: 100,
          title: { display: true, text: "Votes (%)" },
        },
      },
      plugins: {
        annotation: {
          annotations: {
            line1: {
              type: "line",
              scaleID: "y",
              value: 50,
              borderColor: "black",
              borderWidth: 2,
              borderDash: [5, 5],
              label: {
                content: "50% Median",
                enabled: true,
                position: "end",
              },
            },
          },
        } as any,
        datalabels: {
          color: "white", // Ensure high contrast text
          anchor: "center", // Position text in the middle of each bar
          align: "center", // Keep text centered
          font: {
            weight: "bold",
            size: 12,
          },
          formatter: (value) => (value > 0 ? `${value.toFixed(1)}%` : ""), // Hide 0% labels
        },
      },
    },
  };

  const image = await chartJSNodeCanvas.renderToBuffer(configuration);
  fs.writeFileSync("images/majority_judgment_chart.png", image);
  console.log("Chart image saved as images/majority_judgment_chart.png");
};