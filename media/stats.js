(function () {
  const vscode = acquireVsCodeApi();
  let chartInstance = null;
  let currentData = [];
  let isDragging = false;
  let startX, endX;

  document.addEventListener('DOMContentLoaded', function () {
    log('DOM content loaded');
    initializeChart();
  });

  function initializeChart() {
    if (typeof Chart === 'undefined') {
      console.error('Chart.js not loaded. Attempting to load...');
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
      script.onload = () => {
        log('Chart.js loaded successfully');
        setupEventListeners();
      };
      script.onerror = () => {
        displayError('Failed to load Chart.js library');
      };
      document.head.appendChild(script);
    } else {
      setupEventListeners();
    }
  }

  function setupEventListeners() {
    window.addEventListener('message', event => {
      const message = event.data;
      log('Received message:', message);
      try {
        switch (message.type) {
          case 'updateChart':
            log('Updating chart:', message);
            renderChart(message.data);
            break;
          case 'setShadowArea':
            log('Setting shadow area:', message);
            setShadowArea(message.start, message.end);
            break;
          case 'error':
            displayError(message.message);
            break;
        }
      } catch (error) {
        displayError('An error occurred while processing the data.', error);
      }
    });

    window.addEventListener('resize', handleResize);

    const canvas = document.getElementById('chart');
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    log('Event listeners set up');
  }

  // New mouse event handlers to reduce duplication
  function handleMouseDown(e) {
    isDragging = true;
    const rect = e.target.getBoundingClientRect();
    startX = endX = e.clientX - rect.left;
    updateSelection();
  }

  function handleMouseMove(e) {
    if (isDragging) {
      const rect = e.target.getBoundingClientRect();
      endX = e.clientX - rect.left;
      updateSelection();
    }
  }

  function handleMouseUp() {
    if (isDragging) {
      isDragging = false;
      if (startX !== endX) {
        const { start, end } = getDateRangeFromPixels(startX, endX);
        vscode.postMessage({ type: 'selectionMade', start, end });
      }
      clearSelection();
    }
  }

  function handleMouseLeave() {
    if (isDragging) {
      isDragging = false;
      clearSelection();
    }
  }

  function renderChart(data) {
    if (data.length === 0) {
      displayError('No data available for the selected range');
      return;
    }

    data.reverse();

    currentData = data;
    log('Raw data:', JSON.stringify(data.slice(0, 5))); // Log first 5 items
    createOrUpdateChart();
  }

  function calculateBucketCount(chartWidth) {
    const bucketCount = Math.max(30, Math.floor(chartWidth / (16 + 22)));

    log(`Calculated bucket count: ${bucketCount}, chartWidth: ${chartWidth}`);
    return 122;
  }

  function getTimeUnit(start, end) {
    const diffMinutes = Math.ceil((end - start) / (1000 * 60));
    console.log('Date range:', start, 'to', end, 'Diff in minutes:', diffMinutes);
    if (diffMinutes <= 120) return 'minute'; // 2 hours
    if (diffMinutes <= 4320) return 'hour'; // 3 days
    if (diffMinutes <= 43200) return 'day'; // 30 days
    if (diffMinutes <= 172800) return 'day'; // 4 months (120 days)
    if (diffMinutes <= 525600) return 'week'; // 1 year
    return 'month';
  }

  function createOrUpdateChart() {
    const ctx = document.getElementById('chart');
    if (!ctx) {
      displayError('Chart canvas element not found');
      return;
    }

    if (currentData.length === 0) {
      log('No data available for the selected range');
      return;
    }

    const chartWidth = ctx.clientWidth;
    const aggregatedData = aggregateDataIntoBuckets(currentData);
    log('First aggregated item:', JSON.stringify(aggregatedData[0]));
    log('Last aggregated item:', JSON.stringify(aggregatedData[aggregatedData.length - 1]));

    const dateRange = getDateRange(aggregatedData);
    log('Date range:', new Date(dateRange.start), new Date(dateRange.end));

    const timeUnit = getTimeUnit(dateRange.start, dateRange.end);
    log('Selected time unit:', timeUnit);

    const timeUnitFormats = {
      minute: 'HH:mm',
      hour: 'HH:mm',
      day: 'yyyy/MM/dd',
      month: 'yyyy/MM',
      quarter: 'yyyy/MM',
      year: 'yyyy'
    };

    const chartConfig = createChartConfig(aggregatedData, dateRange, timeUnit, chartWidth, timeUnitFormats);

    try {
      if (chartInstance) {
        updateExistingChart(chartInstance, chartConfig);
      } else {
        chartInstance = new Chart(ctx, chartConfig);
      }
      log('Chart created/updated successfully');
    } catch (error) {
      console.error('Error creating/updating chart:', error);
      displayError('Error creating/updating chart: ' + error.message);
    }
  }

  // New helper functions to improve structure and reduce complexity
  function getDateRange(aggregatedData) {
    return {
      start: aggregatedData[0].date,
      end: aggregatedData[aggregatedData.length - 1].date
    };
  }

  function createChartConfig(aggregatedData, dateRange, timeUnit, chartWidth, timeUnitFormats) {
    return {
      type: 'bar',
      data: {
        labels: aggregatedData.map(d => d.date),
        datasets: [
          {
            label: 'Deletions',
            data: aggregatedData.map(d => d.deletions),
            backgroundColor: getComputedStyle(document.documentElement)
              .getPropertyValue('--deletions-background-color')
              .trim(),
            yAxisID: 'y'
          },
          {
            label: 'Insertions',
            data: aggregatedData.map(d => d.insertions),
            backgroundColor: getComputedStyle(document.documentElement)
              .getPropertyValue('--insertions-background-color')
              .trim(),
            yAxisID: 'y'
          },
          {
            label: 'Commits',
            data: aggregatedData.map(d => ({
              x: d.date,
              y: d.commits
            })),
            type: 'line',
            backgroundColor: context => {
              const chart = context.chart;
              const { ctx, scales, chartArea } = chart;
              if (!chartArea) {
                return null;
              }

              const { startPos, endPos } = chart.options.plugins.shadowArea;
              if (startPos !== null && endPos !== null) {
                const left = scales.x.getPixelForValue(aggregatedData[0].date);
                const right = scales.x.getPixelForValue(aggregatedData[aggregatedData.length - 1].date);
                const gradient = ctx.createLinearGradient(left, 0, right, 0);
                const backgroundColor = getComputedStyle(document.documentElement)
                  .getPropertyValue('--chart-background-color')
                  .trim();
                const shadowColor = getComputedStyle(document.documentElement)
                  .getPropertyValue('--chart-shadow-color')
                  .trim();

                gradient.addColorStop(0, backgroundColor);
                gradient.addColorStop(startPos, backgroundColor);
                gradient.addColorStop(startPos, shadowColor);
                gradient.addColorStop(endPos, shadowColor);
                gradient.addColorStop(endPos, backgroundColor);
                gradient.addColorStop(1, backgroundColor);

                return gradient;
              }

              return getComputedStyle(document.documentElement).getPropertyValue('--chart-background-color').trim();
            },
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: true,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: timeUnit,
              displayFormats: {
                ...timeUnitFormats,
                week: 'yyyy/MM/dd'
              },
              tooltipFormat: _ => timeUnitFormats[timeUnit] || timeUnitFormats.month
            },
            stacked: true,
            ticks: {
              maxTicksLimit: calculateMaxTicksLimit(chartWidth),
              autoSkip: true,
              maxRotation: 0,
              minRotation: 0
            },
            min: dateRange.start,
            max: dateRange.end
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            stacked: true,
            title: {
              display: true,
              text: 'Insertions & Deletions'
            }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            stacked: true,
            title: {
              display: true,
              text: 'Commits'
            },
            grid: {
              drawOnChartArea: false
            }
          }
        },
        plugins: {
          tooltip: {
            mode: 'index',
            intersect: false
          },
          shadowArea: {
            startPos: null,
            endPos: null
          },
          selection: {
            startPos: null,
            endPos: null
          }
        },
        animation: {
          duration: 600,
          easing: 'easeOutQuad',
          animations: {
            y: {
              from: 0
            },
            opacity: {
              from: 0,
              to: 1
            }
          }
        }
      },
      plugins: [
        {
          id: 'selectionPlugin',
          beforeDraw: chart => {
            const { ctx, chartArea } = chart;
            const { startPos, endPos } = chart.options.plugins.selection;
            if (startPos !== null && endPos !== null) {
              ctx.save();
              ctx.fillStyle = getComputedStyle(document.documentElement)
                .getPropertyValue('--chart-selection-color')
                .trim();
              ctx.fillRect(
                chartArea.left + startPos * chartArea.width,
                chartArea.top,
                (endPos - startPos) * chartArea.width,
                chartArea.height
              );
              ctx.restore();
            }
          }
        }
      ]
    };
  }

  function updateExistingChart(chart, config) {
    chart.data = config.data;
    chart.options = config.options;
    chart.plugins = config.plugins;
    chart.update();
  }

  function calculateMaxTicksLimit(chartWidth) {
    return Math.max(4, Math.floor(chartWidth / 100));
  }

  function aggregateDataIntoBuckets(data) {
    const start = data[0].date;
    const end = data[data.length - 1].date;
    const bucketCount = 122;

    // Handle case where start and end are very close or identical
    if (end - start < bucketCount) {
      // If the range is smaller than the bucket count, create one bucket per data point
      return data.map(entry => {
        const { insertions, deletions } = parseStats(entry.stats);
        return {
          insertions,
          deletions,
          commits: 1,
          date: entry.date
        };
      });
    }

    const bucketSize = (end - start) / bucketCount;

    const buckets = Array(bucketCount)
      .fill()
      .map(() => ({ insertions: 0, deletions: 0, commits: 0, date: null }));

    data.forEach(entry => {
      const date = entry.date;
      const bucketIndex = Math.min(Math.floor((date - start) / bucketSize), bucketCount - 1);
      const { insertions, deletions } = parseStats(entry.stats);

      buckets[bucketIndex].insertions += insertions;
      buckets[bucketIndex].deletions += deletions;
      buckets[bucketIndex].commits += 1;
      if (!buckets[bucketIndex].date) {
        buckets[bucketIndex].date = date;
      }
    });

    return buckets.filter(bucket => bucket.date !== null);
  }

  function parseStats(statString) {
    if (!statString) {
      return { insertions: 0, deletions: 0 };
    }

    const insertionsMatch = statString.match(/(\d+) insertion/);
    const deletionsMatch = statString.match(/(\d+) deletion/);

    return {
      insertions: insertionsMatch ? parseInt(insertionsMatch[1]) : 0,
      deletions: deletionsMatch ? parseInt(deletionsMatch[1]) : 0
    };
  }

  function displayError(message, error) {
    console.error('Displaying error:', message, error);
    const ctx = document.getElementById('chart');
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  function handleResize() {
    if (chartInstance) {
      log('Resizing chart');
      const aggregatedData = aggregateDataIntoBuckets(currentData);
      updateChartData(chartInstance, aggregatedData);
    }
  }

  function updateChartData(chart, aggregatedData) {
    chart.data.labels = aggregatedData.map(d => d.date);
    chart.data.datasets[0].data = aggregatedData.map(d => d.deletions);
    chart.data.datasets[1].data = aggregatedData.map(d => d.insertions);
    chart.data.datasets[2].data = aggregatedData.map(d => ({
      x: d.date,
      y: d.commits
    }));
    const chartWidth = document.getElementById('chart').clientWidth;
    chart.options.scales.x.ticks.maxTicksLimit = calculateMaxTicksLimit(chartWidth);
    chart.update();
  }

  function setShadowArea(start, end) {
    if (chartInstance) {
      const { scales } = chartInstance;
      const chartStart = scales.x.min;
      const chartEnd = scales.x.max;
      const chartRange = chartEnd - chartStart;

      console.log('Chart date range:', new Date(chartStart), new Date(chartEnd));
      console.log('Requested shadow range:', new Date(start), new Date(end));

      // Calculate positions based on the nearest labels
      let startPos = (start - chartStart) / chartRange;
      let endPos = (end - chartStart) / chartRange;

      // If start and end are the same, create a small range around the point
      if (start === end) {
        const labelRange = 1 / chartInstance.data.labels.length;
        const halfWidth = labelRange * 0.4;
        startPos -= halfWidth;
        endPos += halfWidth;
      }

      startPos = Math.min(1, Math.max(0, startPos));
      endPos = Math.min(1, Math.max(0, endPos));

      log('Setting shadow area:', new Date(start), new Date(end), 'Positions:', startPos, endPos);

      // Update the chart options
      chartInstance.options.plugins.shadowArea = {
        startPos,
        endPos
      };
      chartInstance.update();
    }
  }

  function updateSelection() {
    if (chartInstance) {
      const { chartArea } = chartInstance;

      // Adjust startX and endX to be relative to the chart area
      const adjustedStartX = Math.max(chartArea.left, Math.min(startX, chartArea.right));
      const adjustedEndX = Math.max(chartArea.left, Math.min(endX, chartArea.right));

      // Calculate relative positions
      const startPos = (adjustedStartX - chartArea.left) / chartArea.width;
      const endPos = (adjustedEndX - chartArea.left) / chartArea.width;

      log('Updating selection:', startPos, endPos);
      chartInstance.options.plugins.selection = {
        startPos: startPos,
        endPos: endPos
      };
      chartInstance.update('none'); // Update without animation
    }
  }

  function clearSelection() {
    if (chartInstance) {
      chartInstance.options.plugins.selection = {
        startPos: null,
        endPos: null
      };
      chartInstance.update('none');
    }
  }

  function getDateRangeFromPixels(startX, endX) {
    const { scales, chartArea } = chartInstance;
    if (startX > endX) {
      [startX, endX] = [endX, startX];
    }

    // Adjust startX and endX to be relative to the chart area
    startX = Math.max(chartArea.left, Math.min(startX, chartArea.right));
    endX = Math.max(chartArea.left, Math.min(endX, chartArea.right));

    // Convert pixel positions to chart-relative positions
    const startPos = (startX - chartArea.left) / chartArea.width;
    const endPos = (endX - chartArea.left) / chartArea.width;

    // Get the date range
    const startDate = scales.x.getValueForPixel(chartArea.left + startPos * chartArea.width);
    const endDate = scales.x.getValueForPixel(chartArea.left + endPos * chartArea.width);

    // Convert to ISO string format
    return {
      start: new Date(startDate).toISOString(),
      end: new Date(endDate).toISOString()
    };
  }

  function log(...message) {
    console.log(...message);
  }

  log('Chart.js loaded:', typeof Chart !== 'undefined');
})();
