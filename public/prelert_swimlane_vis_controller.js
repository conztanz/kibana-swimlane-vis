/*
 ****************************************************************************
 *                                                                          *
 * Copyright 2016 Prelert Ltd                                          *
 *                                                                          *
 * Licensed under the Apache License, Version 2.0 (the "License");          *
 * you may not use this file except in compliance with the License.         *
 * You may obtain a copy of the License at                                  *
 *                                                                          *
 *    http://www.apache.org/licenses/LICENSE-2.0                            *
 *                                                                          *
 * Unless required by applicable law or agreed to in writing, software      *
 * distributed under the License is distributed on an "AS IS" BASIS,        *
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. *
 * See the License for the specific language governing permissions and      *
 * limitations under the License.                                           *
 *                                                                          *
 ****************************************************************************
 */

import angular from 'angular';
import _ from 'lodash';
import $ from 'jquery';
import moment from 'moment';
import numeral from 'numeral';

require('flot-charts/jquery.flot');
require('flot-charts/jquery.flot.time');
require('flot-charts/jquery.flot.selection');

import 'ui/courier';
import 'ui/timefilter';
import 'ui/directives/inequality';
import { uiModules } from 'ui/modules';

import { ResizeCheckerProvider } from 'ui/resize_checker';

const module = uiModules.get('prelert_swimlane_vis/prelert_swimlane_vis', ['kibana']);
module.controller('PrelertSwimlaneVisController', function ($scope, courier, $timeout) {

  // Re-render the swimlane when either the data (esResponse) or one
  // of the view options (vis.params), such as band thresholds, change.
  $scope.$watchMulti(['esResponse', 'vis.params'], function ([resp]) {

    if (!resp) {
      $scope._previousHoverPoint = null;
      return;
    }

    let ngHideContainer = null;
    if (resp.hits.total !== 0) {
      // Flot doesn't work too well when calling $.plot on an element that isn't visible.
      // Therefore remove ng-hide from the parent div as that sets display:none, which
      // can result in the flot chart labels falling inside the chart area on first render.
      ngHideContainer = $('prl-swimlane-vis').closest('.ng-hide');
      ngHideContainer.removeClass('ng-hide');
    }

    // Process the aggregations in the ES response.
    $scope.processAggregations(resp.aggregations);

    syncViewControls();

    // Tell the swimlane directive to render.
    // Run in 250ms timeout as when navigating from time range of no results to results,
    // as otherwise the swimlane cells may not be rendered. Flot doesn't seem to work
    // too well when calling $.plot on an element that isn't visible.
    $timeout(() => {
      $scope.$emit('render');
    }, 250);

    if (ngHideContainer !== null) {
      // Add ng-hide class back as it is needed on parent div for dashboard grid maximize functionality.
      ngHideContainer.addClass('ng-hide');
    }

  });

  const dashboardGrid = document.getElementsByTagName('dashboard-grid')[0];
  if (dashboardGrid !== undefined) {
    // Flot doesn't work too well when calling $.plot on an element that isn't visible.
    // So when running inside a dashboard, add a MutationObserver to check for when the
    // ng-hide class is altered on the parent dashboard-grid and re-render.
    // This ensures the flot chart is displayed correctly after the dashboard panel
    // is minimized (minimize actions causes the original panel to be un-hidden), with the
    // lane labels positioned to the left of the lanes.
    const observer = new MutationObserver(function (mutations) {
      const doRender = mutations.some(function (mutation) {
        return mutation.oldValue.includes('ng-hide');
      });

      if (doRender === true) {
        $scope.$emit('render');
      }
    });

    observer.observe(dashboardGrid, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true
    });
  }
    $scope.pushIfNotPresent = function (list,bucket) {
        let present = false;
        _.each(list, function (current)
        {
            if(current['1'].value === bucket['1'].value)
            {
                present = true;
            }
        });
        if(! present)
        {
            list.push(bucket)
        }
    };
    $scope.aggregateByCarrierCode = function (buckets) {
        let carrierCodesMap = {};
        let additionalSimultaneousFlights = {};
        _.each(buckets, function (bucket) {
            // extract Carrier Code
            const currentCarrierCode = bucket.key.split('_')[1].slice(0,2);
            const currentFlightNumber = bucket.key.split('_')[1].slice(2,bucket.key.length);
            const departureStation = bucket.key.split('_')[2];
            // if this carrier code doesn't already exist, we add it
            if(carrierCodesMap[currentCarrierCode] === undefined)
            {
                additionalSimultaneousFlights[currentCarrierCode] = [];
                carrierCodesMap[currentCarrierCode] = {};
                carrierCodesMap[currentCarrierCode].key = currentCarrierCode;
                carrierCodesMap[currentCarrierCode].doc_count = 1;
                carrierCodesMap[currentCarrierCode]['3'] = {};
                carrierCodesMap[currentCarrierCode]['1'] = {};
                carrierCodesMap[currentCarrierCode]['1'].value = bucket['1'].value;
                carrierCodesMap[currentCarrierCode]['3'].buckets = [];

                // the following fields wouldn't normally exist, be we add them to be shown in tooltip
                bucket['3'].buckets[0].carrierCode = currentCarrierCode;
                bucket['3'].buckets[0].currentFlightNumber = currentFlightNumber;
                bucket['3'].buckets[0].departureStation = departureStation;

                carrierCodesMap[currentCarrierCode]['3'].buckets.push(bucket['3'].buckets[0]);
            }
            // if this carrier code already exists, we add the current bucket into it
            else
            {
                // the following fields wouldn't normally exist, be we add them to be shown in tooltip
                bucket['3'].buckets[0].carrierCode = currentCarrierCode;
                bucket['3'].buckets[0].currentFlightNumber = currentFlightNumber;
                let replaced = false;
                let old = false;

                // if this new flight happens to be at the same time we another one, we'll only add if it has a new "status code"
                // if it has a smaller "status code", we'll add it to another list that we'll use later in the tool tip

                _.each(carrierCodesMap[currentCarrierCode]['3'].buckets, function (current, i)
                {

                    // we have a match (a simultaneous flight)
                    if (current.key === bucket['3'].buckets[0].key)
                    {
                        // the new flight has a bigger "status code" ==> we override the already existing one
                        if (bucket['3'].buckets[0]['1'].value > current['1'].value)
                        {
                            carrierCodesMap[currentCarrierCode]['3'].buckets[i] = bucket['3'].buckets[0];
                            replaced = true;
                        }
                        else
                        {
                            old = true;
                        }
                        // we keep track of all simultaneous flights by adding them to this list (if not already added)
                        $scope.pushIfNotPresent(additionalSimultaneousFlights[currentCarrierCode],current);
                        $scope.pushIfNotPresent(additionalSimultaneousFlights[currentCarrierCode],bucket['3'].buckets[0]);
                    }
                });

                if(! replaced && ! old)
                {
                    carrierCodesMap[currentCarrierCode]['3'].buckets.push(bucket['3'].buckets[0]);
                }
                carrierCodesMap[currentCarrierCode].doc_count++;
            }
        });
        let result = [];
        for (let i in carrierCodesMap)
        {
            result.push(carrierCodesMap[i])
        }
        $scope.agg = result;
        $scope.additionalSimultaneousFlights = additionalSimultaneousFlights;
        return result;
    };


  $scope.processAggregations = function (aggregations) {
    const dataByViewBy = {};
    // Keep a list of the 'view by' keys in the order that they were
    // returned by the aggregation which will be used for the lane labels.
    const aggViewByOrder = [];

    if (aggregations &&
      ($scope.vis.aggs.bySchemaName.metric !== undefined) &&
      ($scope.vis.aggs.bySchemaName.timeSplit !== undefined)) {
      // Retrieve the visualization aggregations.
      const metricsAgg = $scope.vis.aggs.bySchemaName.metric[0];
      const timeAgg = $scope.vis.aggs.bySchemaName.timeSplit[0];
      const timeAggId = timeAgg.id;

      if ($scope.vis.aggs.bySchemaName.viewBy !== undefined) {
        // Get the buckets of the viewBy aggregation.
        const viewByAgg = $scope.vis.aggs.bySchemaName.viewBy[0];
        let viewByBuckets = aggregations[viewByAgg.id].buckets;
        viewByBuckets =  $scope.aggregateByCarrierCode(viewByBuckets)
          _.each(viewByBuckets, function (bucket) {
          // There will be 1 bucket for each 'view by' value.
          const viewByValue = bucket.key;
          aggViewByOrder.push(viewByValue);
          const timesForViewBy = {};
          dataByViewBy[viewByValue] = timesForViewBy;

          const bucketsForViewByValue = bucket[timeAggId].buckets;
          _.each(bucketsForViewByValue, function (valueBucket) {
            // time is the 'valueBucket' key.
            timesForViewBy[valueBucket.key] = {
              value: metricsAgg.getValue(valueBucket)
            };
          });
        });
      } else {
        // No 'View by' selected - compile data for a single swimlane
        // showing the time bucketed metric value.
        const timesForViewBy = {};
        const buckets = aggregations[timeAggId].buckets;
        _.each(buckets, function (bucket) {
          timesForViewBy[bucket.key] = { value: metricsAgg.getValue(bucket) };
        });

        // Use the metric label as the swimlane label.
        dataByViewBy[metricsAgg.makeLabel()] = timesForViewBy;
        aggViewByOrder.push(metricsAgg.makeLabel());
      }

    }

    $scope.metricsData = dataByViewBy;
    $scope.aggViewByOrder = aggViewByOrder;
  };

  function syncViewControls() {
    // Synchronize the Interval control to match the aggregation run in the view,
    // e.g. if being edited via the Kibana Visualization tab sidebar.
    if ($scope.vis.aggs.length === 0 || $scope.vis.aggs.bySchemaName.timeSplit === undefined) {
      return;
    }

    // Retrieve the visualization aggregations.
    const timeAgg = $scope.vis.aggs.bySchemaName.timeSplit[0];

    // Update the scope 'interval' field.
    let aggInterval = _.get(timeAgg, ['params', 'interval', 'val']);
    if (aggInterval === 'custom') {
      aggInterval = _.get(timeAgg, ['params', 'customInterval']);
    }

    let scopeInterval = $scope.vis.params.interval.val;
    if (scopeInterval && scopeInterval === 'custom') {
      scopeInterval = $scope.vis.params.interval.customInterval;
    }

    let setToInterval = _.find($scope.vis.type.params.intervalOptions, { val: aggInterval });
    if (!setToInterval) {
      setToInterval = _.find($scope.vis.type.params.intervalOptions, { customInterval: aggInterval });
    }
    if (!setToInterval) {
      // e.g. if running inside the Kibana Visualization tab will need to add an extra option in.
      setToInterval = {};

      if (_.get(timeAgg, ['params', 'interval', 'val']) !== 'custom') {
        setToInterval.val = _.get(timeAgg, ['params', 'interval', 'val']);
        setToInterval.display = 'Custom: ' + _.get(timeAgg, ['params', 'interval', 'val']);
      } else {
        setToInterval.val = 'custom';
        setToInterval.customInterval = _.get(timeAgg, ['params', 'customInterval']);
        setToInterval.display = 'Custom: ' + _.get(timeAgg, ['params', 'customInterval']);
      }

      $scope.vis.type.params.intervalOptions.push(setToInterval);
    }


    // Set the flags which indicate if the interval has been scaled.
    // e.g. if requesting points at 5 min interval would result in too many buckets being returned.
    const timeBucketsInterval = timeAgg.buckets.getInterval();
    setToInterval.scaled = timeBucketsInterval.scaled;
    setToInterval.scale = timeBucketsInterval.scale;
    setToInterval.description = timeBucketsInterval.description;

    $scope.vis.params.interval = setToInterval;
  }

  $scope.updateViewState = function () {
    // Set up the visualization in response to a change in the Interval control.
    setupVisualization()
    .then(function () {
      // Re-run the dashboard search.
      return courier.fetch();
    })
    .catch(function (error) {
      console.log('Error updating swimlane visualization with new view state.', error);
    });
  };

  function setupVisualization() {
    // Set the params of the time aggregation to the selected 'interval' field.
    if ($scope.vis) {
      // Set the aggregation interval of the 'timeSplit' aggregation.
      const visState = $scope.vis.getState();
      const timeAgg = _.find(visState.aggs, { 'schema': 'timeSplit' });
      timeAgg.params.interval = $scope.vis.params.interval.val;
      if ($scope.vis.params.interval.val === 'custom') {
        timeAgg.params.customInterval = $scope.vis.params.interval.customInterval;
      }

      $scope.vis.setState(visState);

      // Update the time interval of the 'editable vis'
      // i.e. if visualization is being viewed in the Kibana Visualize view,
      // we need to update the configurations for the aggregations in the editor sidebar.
      const editableVis = $scope.vis.getEditableVis();
      if (editableVis) {
        const editableVisState = editableVis.getState();
        const editableTimeAgg = _.find(editableVisState.aggs, { 'schema': 'timeSplit' });
        editableTimeAgg.params.interval = $scope.vis.params.interval.val;
        if ($scope.vis.params.interval.val === 'custom') {
          editableTimeAgg.params.customInterval = $scope.vis.params.interval.customInterval;
        }

        editableVis.setState(editableVisState);
      }

      return Promise.resolve($scope.vis);
    }

  }

  $scope.prelertLogoSrc = require('plugins/prelert_swimlane_vis/prelert_logo_24.png');

})
.directive('prlSwimlaneVis', function ($compile, timefilter, config, Private,$window) {

  function link(scope, element) {

    scope._previousHoverPoint = null;
    scope._influencerHoverScope = null;
    scope._resizeChecker = null;
    scope.$on('render',function () {
      if (scope.vis.aggs.length !== 0 && scope.vis.aggs.bySchemaName.timeSplit !== undefined
        && _.keys(scope.metricsData).length > 0) {

        if (scope._resizeChecker !== null) {
          scope._resizeChecker.destroy();
        }

        renderSwimlane();
      }
    });

    function renderSwimlane() {
      const chartData = scope.metricsData || [];
      const allSeries = [];

      // Create a series for each severity color band,
      // plus an 'unknown' series for scores less than the 'low' threshold.
      const colorBands = [scope.vis.params.unknownThresholdColor,
        scope.vis.params.toBeScheduledThresholdColor,
        scope.vis.params.scheduledThresholdColor,
        scope.vis.params.expectedThresholdColor,
        scope.vis.params.canceledThresholdColor,
        scope.vis.params.receivedOnTimeThresholdColor,
        scope.vis.params.receivedWithDelayThresholdColor,
        scope.vis.params.missingThresholdColor];

      const seriesLabels = ['unknown','low','warning','minor','major','critical','critical','critical'];
      // const seriesLabels = ['To beScheduled','Scheduled','Expected','Canceled','Received On Time','Received With Delay','Missing'];
        _.each(colorBands, function (color, i) {
        const series = {};
        series.label = seriesLabels[i];
        series.color = color;
        series.points = { fillColor: color, show: true, radius: 5, symbol: drawChartSymbol,  lineWidth: 1 };
        series.data = [];
        series.shadowSize = 0;
        allSeries.push(series);
      });

      let laneIds = scope.aggViewByOrder.slice(0);
        if (scope.vis.params.alphabetSortLaneLabels === 'asc' ||
        scope.vis.params.alphabetSortLaneLabels === 'desc') {

        laneIds.sort(function (a, b) {
          // Use String.localeCompare with the numeric option enabled.
          return a.localeCompare(b, undefined, { numeric: true });
        });

        if (scope.vis.params.alphabetSortLaneLabels === 'asc') {
          // Reverse the keys as the lanes are rendered bottom up.
          laneIds = laneIds.reverse();
        }

      } else {
        // Reverse the order of the lane IDs as they are rendered bottom up.
        laneIds = laneIds.reverse();
      }

      let laneIndex = 0;
      _.each(chartData, function (bucketsForViewByValue, viewByValue) {

        laneIndex = laneIds.indexOf(viewByValue);

        _.each(bucketsForViewByValue, function (dataForTime, time) {
          const value = dataForTime.value;

          const pointData = new Array();
          pointData[0] = moment(Number(time));
          pointData[1] = laneIndex + 0.5;
          // Store the score in an additional object property for each point.
          pointData[2] = { score: value };

          const seriesIndex = getSeriesIndex(value);
          allSeries[seriesIndex].data.push(pointData);
        });
      });

      // Extract the bounds of the time filter so we can set the x-axis min and max.
      // If no min/max supplied, Flot will automatically set them according to the data values.
      const bounds = timefilter.getActiveBounds();
      let earliest = null;
      let latest = null;
      if (bounds) {
        const timeAgg = scope.vis.aggs.bySchemaName.timeSplit[0];
        const aggInterval = timeAgg.buckets.getInterval();

        // Elasticsearch aggregation returns points at start of bucket,
        // so set the x-axis min to the start of the aggregation interval.
        earliest = moment(bounds.min).startOf(aggInterval.description).valueOf();
        latest = moment(bounds.max).valueOf();
      }

      const options = {
        xaxis: {
          mode: 'time',
          timeformat: '%d %b %H:%M',
          tickFormatter: function (v, axis) {
            // Only show time if tick spacing is less than a day.
            const tickGap = (axis.max - axis.min) / 10000;  // Approx 10 ticks, convert to sec.
            if (tickGap < 86400) {
              return moment(v).format('MMM D HH:mm');
            } else {
              return moment(v).format('MMM D YYYY');
            }
          },
          min: _.isUndefined(earliest) ? null : earliest,
          max: _.isUndefined(latest) ? null : latest,
          color: '#d5d5d5'
        },
        yaxis: {
          min: 0,
          color: null,
          tickColor: null,
          tickLength: 0,
        },
        grid: {
          backgroundColor: null,
          borderWidth: 1,
          hoverable: true,
          clickable: true,
          borderColor: '#cccccc',
          color: null,
        },
        legend : {
          show: scope.vis.params.showLegend,
          noColumns: colorBands.length,
          container: angular.element(element).closest('.prl-swimlane-vis').find('.prl-swimlane-vis-legend'),
          labelBoxBorderColor: 'rgba(255, 255, 255, 0);',
          labelFormatter: function (label) {
            if (label !== 'unknown') {
              const thresholdParamName = label + 'Threshold';
              return '' + scope.vis.params[thresholdParamName];
            }
            return null;
          }
        },
        selection: {
          mode: 'x',
          color: '#bbbbbb'
        }
      };

      // Set the alternate lane marking color depending on whether Kibana dark theme is being used.
      const alternateLaneColor = element.closest('.theme-dark').length === 0 ? '#f5f5f5' : '#4a4a4a';

      options.yaxis.max = laneIds.length;
      options.yaxis.ticks = [];
      options.grid.markings = [];

      let yaxisMarking;
      _.each(laneIds, function (labelId, i) {
        let labelText = labelId;

        // Crop 'viewBy' labels over 27 chars of more so that the y-axis labels don't take up too much width.
        labelText = (labelText.length < 28 ? labelText : labelText.substring(0, 25) + '...');
        const tick = [i + 0.5, labelText];
        options.yaxis.ticks.push(tick);

        // Set up marking effects for each lane.
        if (i > 0) {
          yaxisMarking = {};
          yaxisMarking.from = i;
          yaxisMarking.to = i + 0.03;
          options.grid.markings.push({ yaxis: yaxisMarking, color: '#d5d5d5' });
        }

        if (i % 2 !== 0) {
          yaxisMarking = {};
          yaxisMarking.from = i + 0.03;
          yaxisMarking.to = i + 1;
          options.grid.markings.push({ yaxis: yaxisMarking, color: alternateLaneColor });
        }
      });

      // Adjust height of element according to the number of lanes, allow for height of axis labels.
      // Uses hardcoded height for each lane of 32px, with the chart symbols having a height of 28px.
      element.height((laneIds.length * 32) + 50);

      // Draw the plot.
      const plot = $.plot(element, allSeries, options);

      // Redraw the chart when the container is resized.
      // Resize action is the same as that performed in the jquery.flot.resize plugin,
      // but use the Kibana ResizeCheckerProvider for simplicity and because the
      // jquery.flot.resize is not included with the flot plugins included by the Kibana metrics plugin.
      const ResizeChecker = Private(ResizeCheckerProvider);
      scope._resizeChecker = new ResizeChecker(angular.element(element).closest('.prl-swimlane-vis'));
      scope._resizeChecker.on('resize', () => {
        const placeholder = plot.getPlaceholder();

        // somebody might have hidden us and we can't plot
        // when we don't have the dimensions
        if (placeholder.width() === 0 || placeholder.height() === 0) {
          return;
        }

        plot.resize();
        plot.setupGrid();
        plot.draw();
      });

      element.on('$destroy', () => {
        scope._resizeChecker.destroy();
      });

      // Add tooltips to the y-axis labels to display the full 'viewBy' field
      // - useful for cases where a long text value has been cropped.
      // NB. requires z-index set in CSS so that hover is picked up on label.
      const yAxisLabelDivs = $('.flot-y-axis', angular.element(element)).find('.flot-tick-label');
      _.each(laneIds, function (labelId, i) {
        const labelText = labelId;
        $(yAxisLabelDivs[i]).attr('title', labelText);
      });

      // Show tooltips on point hover.
      element.unbind('plothover');
      element.bind('plothover', function (event, pos, item) {
        if (item) {
          element.addClass('prl-swimlane-vis-point-over ');
          if (scope._previousHoverPoint !== item.dataIndex) {
            scope._previousHoverPoint = item.dataIndex;
            $('.prl-swimlane-vis-tooltip').remove();
            if (scope._influencerHoverScope) {
              scope._influencerHoverScope.$destroy();
            }

            const hoverLaneIndex = item.series.data[item.dataIndex][1] - 0.5;
            const laneLabel = laneIds[hoverLaneIndex];
            showTooltip(item, laneLabel);
          }
        } else {
          element.removeClass('prl-swimlane-vis-point-over ');
          $('.prl-swimlane-vis-tooltip').remove();
          scope._previousHoverPoint = null;
          if (scope._influencerHoverScope) {
            scope._influencerHoverScope.$destroy();
          }
        }
      });

      // Set the Kibana timefilter if the user selects a range on the chart.
      element.unbind('plotselected');
      element.bind('plotselected', function (event, ranges) {
        let zoomFrom = ranges.xaxis.from;
        let zoomTo = ranges.xaxis.to;

        // Aggregation returns points at start of bucket, so make sure the time
        // range zoomed in to covers the full aggregation interval.
        const timeAgg = scope.vis.aggs.bySchemaName.timeSplit[0];
        const aggIntervalMs = timeAgg.buckets.getInterval().asMilliseconds();

        // Add a bit of extra padding before start time.
        zoomFrom = zoomFrom - (aggIntervalMs / 4);
        zoomTo = zoomTo + aggIntervalMs;

        timefilter.time.from = moment.utc(zoomFrom);
        timefilter.time.to = moment.utc(zoomTo);
        timefilter.time.mode = 'absolute';
      });
        element.unbind('plotclick');
        element.bind('plotclick', function (event, ranges,item) {
            // if the item is null then the user didn't click on a rectangle, it is probably a resize, so we just don't do anything
            if(item !== null)
            {
                // objectId computation
                const pointTime = item.datapoint[0];
                const hoverLaneIndex = item.series.data[item.dataIndex][1] - 0.5;
                const carrierCode = laneIds[hoverLaneIndex];
                const worstFlight  = extractWorstFlight(pointTime,scope.agg,scope.additionalSimultaneousFlights,carrierCode);
                const formattedDate = moment(pointTime).format('YYYYMMDD');
                const objectId = formattedDate + "_" + carrierCode + worstFlight.currentFlightNumber + "_" + worstFlight.departureStation ;
                $window.open('https://'+scope.vis.params.apiPnrBaseUrl+'/#/message?objectId='+objectId, '_blank');
            }
        });


        }


      /**
       * Originally, this function was used to map ranges of values to a status
       * But now we have a direct mapping (2 ==> scheduled)  see we just return the same value (the function is useless )
       * @param value
       * @returns {*}
       */
    function getSeriesIndex(value) {
        return value;
    }

    function drawChartSymbol(ctx, x, y, radius) {
      const size = radius * Math.sqrt(Math.PI) / 2;
      ctx.rect(x - size, y - 14, size + size, 28);
    }

      /**
       *
       * @param pointTime
       * @param carrierCodeAggs
       * @param carrierCode
       * @returns {Array}
       */
    function extractFlights(pointTime,carrierCodeAggs,additionalSimultaneousFlights,carrierCode) {
      let simultaneousFlights = [];
      if(additionalSimultaneousFlights[carrierCode] !== undefined)
      {
        if(additionalSimultaneousFlights[carrierCode].length > 0 && additionalSimultaneousFlights[carrierCode][0].key === pointTime )
        return additionalSimultaneousFlights[carrierCode];
      }
      _.each(carrierCodeAggs, function (carrierCodeAgg) {
          _.each(carrierCodeAgg['3'].buckets, function (bucket) {
            if(bucket.key === pointTime && bucket.carrierCode === carrierCode) {
              simultaneousFlights.push(bucket);
            }
          })
      });
      return simultaneousFlights;
    }

      /**
       *
       * @param pointTime
       * @param carrierCodeAggs
       * @param additionalSimultaneousFlights
       * @param carrierCode
       */
      function extractWorstFlight(pointTime, carrierCodeAggs, additionalSimultaneousFlights, carrierCode) {
          let simultaneousFlights = extractFlights(pointTime, carrierCodeAggs, additionalSimultaneousFlights, carrierCode);
          let worstFlight = simultaneousFlights [0];
          _.each(simultaneousFlights, function (flight) {
              if (flight['1'].value > worstFlight['1'].value)
              {
                  worstFlight = flight;
              }
          });
          return worstFlight;
      }


      function showTooltip(item, laneLabel) {
          const pointTime = item.datapoint[0];
          const dataModel = item.series.data[item.dataIndex][2];
          const metricsAgg = scope.vis.aggs.bySchemaName.metric[0];
          const metricLabel = metricsAgg.makeLabel();
          const displayScore = numeral(dataModel.score).format(scope.vis.params.tooltipNumberFormat);
          // Display date using dateFormat configured in Kibana settings.
          const formattedDate = moment(pointTime).format('MMMM Do YYYY, HH:mm');
          const simultaneousFlights = extractFlights(pointTime, scope.agg, scope.additionalSimultaneousFlights, laneLabel);
          let contents = formattedDate + '<br/><hr/>';
          _.each(simultaneousFlights, function (flight) {
              contents += flight.carrierCode + ' - ' + flight.currentFlightNumber + ' - ' + receptionStatusLabel(flight['1'].value) + '<br/>';
          });
          const x = item.pageX;
          const y = item.pageY;
          const offset = 5;
          $('<div class="prl-swimlane-vis-tooltip">' + contents + '</div>').css({
              'position': 'absolute',
              'display': 'none',
              'z-index': 1,
              'top': y + offset,
              'left': x + offset
          }).appendTo('body').fadeIn(200);

          // Position the tooltip.
          const $win = $(window);
          const winHeight = $win.height();
          const yOffset = window.pageYOffset;
          const width = $('.prl-swimlane-vis-tooltip').outerWidth(true);
          const height = $('.prl-swimlane-vis-tooltip').outerHeight(true);

          $('.prl-swimlane-vis-tooltip').css('left', x + offset + width > $win.width() ? x - offset - width : x + offset);
          $('.prl-swimlane-vis-tooltip').css('top', y + height < winHeight + yOffset ? y : y - height);

      }
  }

    /**
     *
     * @param status
     */
    function receptionStatusLabel(status) {
        switch (status) {
            case 1:
                return "To be scheduled";
            case 2:
                return "Scheduled";
            case 3:
                return "Expected";
            case 4:
                return "Canceled";
            case 5:
                return "Received on Time";
            case 6:
                return "Received with delay";
            case 7:
                return "Missing";
        }
    }
  return {
    link: link
  };
});