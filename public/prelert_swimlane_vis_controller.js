/*
 ****************************************************************************
 *                                                                          *
 * Copyright 2012-2018 Elasticsearch BV                                     *
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
import moment from 'moment';
import numeral from 'numeral';
import $ from 'ui/flot-charts';
import logo from './prelert_logo_24.png';
import {ResizeCheckerProvider} from 'ui/resize_checker';
import {uiModules} from 'ui/modules';

const module = uiModules.get('prelert_swimlane_vis/prelert_swimlane_vis', ['kibana']);
module.controller('PrelertSwimlaneVisController', function ($scope, courier, $timeout) {

    $scope.lineLabels = new Map();
    $scope.prelertLogoSrc = logo;

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
        const observer = new MutationObserver((mutations) => {
            const doRender = mutations.some((mutation) => {
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
    $scope.pushIfNotPresent = function (list, bucket) {
        let present = false;
        _.each(list, function (current) {
            // if (current['1'].value === bucket['1'].value) {
            if (current.iataObjectId === bucket.iataObjectId) {
                present = true;
            }
        });
        if (!present) {
            list.push(bucket);
        }
    };

    $scope.buildLineLabel = function (iataCarrierCode, iataFlightNumber, icaoCode, carrierName) {
        // return carrierName + '<br>(' + icaoCode
        //     + (iataCarrierCode !== undefined ? '/' + iataCarrierCode : '')
        //     + ')';
        return (iataCarrierCode !== undefined ? iataCarrierCode + ' ' : '')
            + '(' + icaoCode + '-' + carrierName + ')';
    };

    $scope.aggregateByCarrierCode = function (buckets) {

        let carrierCodesMap = {};
        let additionalSimultaneousFlights = {};
        $scope.lineLabels.clear();
        _.each(buckets, function (bucket) {

            // Value examples:
            // 20181207_LGL9563_ELLX/20181207_LG9563_LUX/Luxair/LG
            // 20181207_THY7NP_ELLX/null/Turkish Airlines/TK

            // Since 2019-01-25 (for LUX DEMO):
            // 20190125_TAP694_LPPT/null/TAP Portugal/TP/LIS-LUX/PNR:Missing-API:Missing/ATD:2019-01-25T13:47:00.000Z/ATA:2019-01-25T13:47:00.000Z/ETD:2019-01-25T13:47:00.000Z/flightStatus:ATC_ACTIVATED/PNRPUSH:2019-01-25T13:47:00.000Z_APIPUSH:2019-01-25T13:47:00.000Z

            console.log('bucket.key=' + bucket.key);

            // extract Icao Carrier Code etc
            let splitBucketKey = bucket.key.split('/');
            const icaoObjectId = splitBucketKey[0];
            const iataObjectId = splitBucketKey[1];
            let carrierName = splitBucketKey[2];
            let iataCarrierCode = splitBucketKey[3];
            let routing = splitBucketKey[4];
            let pnrStatus = 'Scheduled';
            let apiStatus = 'Scheduled';
            let atdGmt;
            let ataGmt;
            let etdGmt;
            let flightState;
            let pnrPush;
            let apiPush;

            let iataFlightNumber;
            if (iataObjectId !== undefined && iataObjectId !== 'null') {
                const iataSplit = iataObjectId.split("_");
                if (iataSplit.length > 1) {
                    const iataObjectIdSplit = iataSplit[1];
                    if (iataObjectIdSplit.length > 1) {
                        iataFlightNumber = iataObjectIdSplit.substring(2);
                    }
                }
            }
            const statuses = splitBucketKey[5];
            if (statuses !== undefined) {
                const statusesSplit = statuses.split('-');
                pnrStatus = statusesSplit[0].substring(4);
                apiStatus = statusesSplit[1].substring(4);
            }

            const atd = splitBucketKey[6];
            if (atd !== undefined && atd.length > 0) {
                const atdSplit = atd.split("=");
                atdGmt = new Date(atdSplit[1]);
            }
            const ata = splitBucketKey[7];
            if (ata !== undefined && ata.length > 0) {
                const ataSplit = ata.split("=");
                ataGmt = new Date(ataSplit[1]);
            }
            const etd = splitBucketKey[8];
            if (etd !== undefined && etd.length > 0) {
                const etdSplit = etd.split("=");
                etdGmt = new Date(etdSplit[1]);
            }

            const flightStatus = splitBucketKey[9];
            if (flightStatus !== undefined && flightStatus.length > 0) {
                const flightStatusSplit = flightStatus.split("=")
                flightState = flightStatusSplit[1];
            }

            let pnrPushSection = splitBucketKey[10];
            if (pnrPushSection !== undefined && pnrPushSection.length > 0) {
                // "PNRPUSH:<value>"
                let pnrpushSplit = pnrPushSection.split("=");
                pnrPush = new Date(pnrpushSplit[1]);
            }
            let apiPushSection = splitBucketKey[11];
            if (apiPushSection !== undefined && apiPushSection.length > 0) {
                // "APIPUSH:<value>"
                let apiPushSplit = apiPushSection.split("=");
                apiPush = new Date(apiPushSplit[1]);
            }

            const currentIcaoCarrierCode = icaoObjectId.split('_')[1].slice(0, 3);
            const currentIcaoFlightNumber = icaoObjectId.split('_')[1].slice(3, bucket.key.length);
            const departureStation = icaoObjectId.split('_')[2];

            $scope.lineLabels.set(currentIcaoCarrierCode, $scope.buildLineLabel(iataCarrierCode, iataFlightNumber, currentIcaoCarrierCode, carrierName));

            let displayKey = $scope.lineLabels.get(currentIcaoCarrierCode);

            // if this carrier code doesn't already exist, we add it
            if (carrierCodesMap[currentIcaoCarrierCode] === undefined) {
                additionalSimultaneousFlights[displayKey] = [];
                carrierCodesMap[currentIcaoCarrierCode] = {};
                carrierCodesMap[currentIcaoCarrierCode].key = displayKey;
                carrierCodesMap[currentIcaoCarrierCode].doc_count = 1;
                carrierCodesMap[currentIcaoCarrierCode]['3'] = {};
                carrierCodesMap[currentIcaoCarrierCode]['1'] = {};
                carrierCodesMap[currentIcaoCarrierCode]['1'].value = bucket['1'].value;
                carrierCodesMap[currentIcaoCarrierCode]['3'].buckets = [];

                // the following fields wouldn't normally exist, be we add them to be shown in tooltip
                bucket['3'].buckets[0].carrierCode = currentIcaoCarrierCode;
                bucket['3'].buckets[0].iataObjectId = iataObjectId;
                bucket['3'].buckets[0].currentFlightNumber = currentIcaoFlightNumber;
                bucket['3'].buckets[0].departureStation = departureStation;
                bucket['3'].buckets[0].displayKey = displayKey;
                bucket['3'].buckets[0].iataCarrierCode = iataCarrierCode;
                bucket['3'].buckets[0].routing = routing;

                bucket['3'].buckets[0].iataFlightNumber = iataFlightNumber;

                bucket['3'].buckets[0].pnrStatus = pnrStatus;
                bucket['3'].buckets[0].apiStatus = apiStatus;
                bucket['3'].buckets[0].atdGmt = atdGmt;
                bucket['3'].buckets[0].ataGmt = ataGmt;
                bucket['3'].buckets[0].etdGmt = etdGmt;
                bucket['3'].buckets[0].flightState = flightState;
                bucket['3'].buckets[0].pnrPush = pnrPush;
                bucket['3'].buckets[0].apiPush = apiPush;

                carrierCodesMap[currentIcaoCarrierCode]['3'].buckets.push(bucket['3'].buckets[0]);
            }
            // if this carrier code already exists, we add the current bucket into it
            else {
                bucket['3'].buckets[0].carrierCode = currentIcaoCarrierCode;
                bucket['3'].buckets[0].currentFlightNumber = currentIcaoFlightNumber;
                bucket['3'].buckets[0].departureStation = departureStation;
                bucket['3'].buckets[0].iataObjectId = iataObjectId;
                bucket['3'].buckets[0].displayKey = displayKey;
                bucket['3'].buckets[0].iataCarrierCode = iataCarrierCode;
                bucket['3'].buckets[0].routing = routing;

                bucket['3'].buckets[0].iataFlightNumber = iataFlightNumber;

                bucket['3'].buckets[0].pnrStatus = pnrStatus;
                bucket['3'].buckets[0].apiStatus = apiStatus;
                bucket['3'].buckets[0].atdGmt = atdGmt;
                bucket['3'].buckets[0].ataGmt = ataGmt;
                bucket['3'].buckets[0].etdGmt = etdGmt;
                bucket['3'].buckets[0].flightState = flightState;
                bucket['3'].buckets[0].pnrPush = pnrPush;
                bucket['3'].buckets[0].apiPush = apiPush;

                carrierCodesMap[currentIcaoCarrierCode].key = displayKey;

                let replaced = false;
                let old = false;

                let newFlight = bucket['3'].buckets[0];

                // if this new flight happens to be at the same time as another one, we'll only add if it has a new "status code"
                // if it has a smaller "status code", we'll add it to another list that we'll use later in the tool tip
                _.each(carrierCodesMap[currentIcaoCarrierCode]['3'].buckets, function (current, i) {

                    // we have a match (a simultaneous flight)
                    if (current.key === newFlight.key) {
                        // console.log('----------------- Simultaneous flight '+currentIcaoCarrierCode+':');
                        // console.log('Current : ' + current.key + ':' + current.currentFlightNumber);
                        // console.log('New     : ' + newFlight.key + ':' + newFlight.currentFlightNumber);
                        // the new flight has a bigger "status code" ==> we override the already existing one
                        let newFlightMaxStatusCode = newFlight['1'].value;
                        let currentFlightMaxStatusCode = current['1'].value;
                        // console.log('Flight ' + newFlightNumber + ' : newFlightMaxStatusCode='+newFlightMaxStatusCode + '/currentFlightMaxStatusCode='+currentFlightMaxStatusCode);
                        if (newFlightMaxStatusCode > currentFlightMaxStatusCode) {
                            carrierCodesMap[currentIcaoCarrierCode]['3'].buckets[i] = newFlight;
                            replaced = true;
                        } else {
                            old = true;
                        }
                        // we keep track of all simultaneous flights by adding them to this list (if not already added)
                        $scope.pushIfNotPresent(additionalSimultaneousFlights[displayKey], current);
                        $scope.pushIfNotPresent(additionalSimultaneousFlights[displayKey], newFlight);
                    }
                });

                if (!replaced && !old) {
                    carrierCodesMap[currentIcaoCarrierCode]['3'].buckets.push(newFlight);
                }
                carrierCodesMap[currentIcaoCarrierCode].doc_count++;
            }
        });
        let result = [];
        for (let i in carrierCodesMap) {
            result.push(carrierCodesMap[i]);
        }
        $scope.agg = result;

        $scope.additionalSimultaneousFlights = additionalSimultaneousFlights;
        return result;
    };

    /**
     *
     * @param buckets
     */
    $scope.sortBucketsByKey = function (buckets) {
        if (buckets !== undefined) {
            // $scope.lineLabels.clear();
            var sorted = buckets.sort((bucket1, bucket2) => {
                if (bucket1.key > bucket2.key) return 1;
                if (bucket1.key < bucket2.key) return -1;
                return 0;
            })
            $scope.agg = sorted;
            return sorted;
        }
        return buckets;
    }

    /**
     *
     * @param aggregations
     */
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
                viewByBuckets = $scope.aggregateByCarrierCode(viewByBuckets);
                $scope.sortBucketsByKey(viewByBuckets);
                _.each(viewByBuckets, function (bucket) {
                    // There will be 1 bucket for each 'view by' value.
                    const viewByValue = bucket.key.toString();

                    // Store 'view by' values as Strings in aggViewByOrder array
                    // to match keys in dataByViewBy Object.
                    aggViewByOrder.push(viewByValue);
                    const timesForViewBy = {};
                    dataByViewBy[viewByValue] = timesForViewBy;

                    const bucketsForViewByValue = bucket[timeAggId].buckets;
                    _.each(bucketsForViewByValue, (valueBucket) => {
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
                _.each(buckets, (bucket) => {
                    timesForViewBy[bucket.key] = {value: metricsAgg.getValue(bucket)};
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
        // Note for Kibana 6.0 and 6.1 there is no extra 'Interval' control
        // inside the visualization. This is removed because of a bug
        // with the Kibana Angular visualization type where an update event
        // is was not correctly propagated up to visualize when calling updateState()
        // from inside the visualization.
        // This has been fixed in Kibana 6.2, see https://github.com/elastic/kibana/pull/15629

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

        let setToInterval = _.find($scope.vis.type.visConfig.intervalOptions, {val: aggInterval});
        if (!setToInterval) {
            setToInterval = _.find($scope.vis.type.visConfig.intervalOptions, {customInterval: aggInterval});
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

            $scope.vis.type.visConfig.intervalOptions.push(setToInterval);
        }

        // Set the flags which indicate if the interval has been scaled.
        // e.g. if requesting points at 5 min interval would result in too many buckets being returned.
        const timeBucketsInterval = timeAgg.buckets.getInterval();
        setToInterval.scaled = timeBucketsInterval.scaled;
        setToInterval.scale = timeBucketsInterval.scale;
        setToInterval.description = timeBucketsInterval.description;

        $scope.vis.params.interval = setToInterval;
    }
})
    .directive('prlSwimlaneVis', function ($compile, timefilter, config, Private, $window, $interval) {

        let crossairRefreshTimer = null;

        function link(scope, element) {

            scope._previousHoverPoint = null;
            scope._influencerHoverScope = null;
            scope._resizeChecker = null;

            scope.$on('render', () => {
                if (scope.vis.aggs.length !== 0 && scope.vis.aggs.bySchemaName.timeSplit !== undefined &&
                    _.keys(scope.metricsData).length > 0) {

                    if (scope._resizeChecker !== null) {
                        scope._resizeChecker.destroy();
                    }

                    renderSwimlane();

                    // Call renderComplete now that swimlane has been rendered.
                    scope.renderComplete();
                }
            });

            function renderSwimlane() {
                const chartData = scope.metricsData || [];

                // Create a series for each severity color band.
                const allSeries = _.map(scope.vis.params.thresholdBands, (thresholdBand, index) => {
                    return {
                        label: `series_${index}`,
                        color: thresholdBand.color,
                        points: {
                            fillColor: thresholdBand.color,
                            show: true,
                            radius: 5,
                            symbol: drawChartSymbol,
                            lineWidth: 1
                        },
                        data: [],
                        shadowSize: 0,
                        thresholdValue: thresholdBand.value
                    };
                });

                // Add an 'unknown' series for indicating scores less than the lowest configured threshold.
                allSeries.unshift({
                    label: `series_unknown`,
                    color: scope.vis.params.unknownThresholdColor,
                    points: {
                        fillColor: scope.vis.params.unknownThresholdColor,
                        show: true,
                        radius: 5,
                        symbol: drawChartSymbol,
                        lineWidth: 1
                    },
                    data: [],
                    shadowSize: 0
                });

                let laneIds = scope.aggViewByOrder.slice(0);
                if (scope.vis.params.alphabetSortLaneLabels === 'asc' ||
                    scope.vis.params.alphabetSortLaneLabels === 'desc') {

                    laneIds.sort((a, b) => {
                        // Use String.localeCompare with the numeric option enabled.
                        return a.localeCompare(b, undefined, {numeric: true});
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
                _.each(chartData, (bucketsForViewByValue, viewByValue) => {

                    laneIndex = laneIds.indexOf(viewByValue);

                    _.each(bucketsForViewByValue, (dataForTime, time) => {
                        const value = dataForTime.value;

                        const pointData = [];
                        pointData[0] = moment(Number(time));
                        pointData[1] = laneIndex + 0.5;
                        // Store the score in an additional object property for each point.
                        pointData[2] = {score: value};

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
                        timeformat: '%H:%M',
                        tickFormatter: function (v, axis) {
                            // Only show time if tick spacing is less than a day.
                            const tickGap = (axis.max - axis.min) / 10000;  // Approx 10 ticks, convert to sec.
                            if (tickGap < 86400) {
                                return moment(v).format('HH:mm');
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
                        tickLength: 0
                    },
                    grid: {
                        backgroundColor: null,
                        borderWidth: 1,
                        hoverable: true,
                        clickable: true,
                        borderColor: '#cccccc',
                        color: null
                    },
                    legend: {
                        show: scope.vis.params.showLegend,
                        noColumns: scope.vis.params.thresholdBands.length,
                        container: angular.element(element).closest('.prl-swimlane-vis').find('.prl-swimlane-vis-legend'),
                        labelBoxBorderColor: 'rgba(255, 255, 255, 0);',
                        labelFormatter: function (label, series) {
                            if (label !== 'series_unknown') {
                                return `${series.thresholdValue}`;
                            }
                            return null;
                        }
                    },
                    crosshair: {
                        mode: 'x'
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
                _.each(laneIds, (labelId, i) => {
                    // const iataCarrierCode = labelId.toString().substring(0,2).fontsize(14)
                    // const details = labelId.toString().substring(2).fontsize(8)
                    // let labelText = iataCarrierCode + details;
                    let labelText = labelId;

                    // Crop 'viewBy' labels over 27 chars of more so that the y-axis labels don't take up too much width.
                    //labelText = (labelText.toString().length < 28 ? labelText : labelText.toString().substring(0, 25) + '...');

                    const tick = [i + 0.5, labelText];
                    options.yaxis.ticks.push(tick);

                    // Set up marking effects for each lane.
                    if (i > 0) {
                        yaxisMarking = {};
                        yaxisMarking.from = i;
                        yaxisMarking.to = i + 0.03;
                        options.grid.markings.push({yaxis: yaxisMarking, color: '#d5d5d5'});
                    }

                    if (i % 2 !== 0) {
                        yaxisMarking = {};
                        yaxisMarking.from = i + 0.03;
                        yaxisMarking.to = i + 1;
                        options.grid.markings.push({yaxis: yaxisMarking, color: alternateLaneColor});
                    }
                });

                // Adjust height of element according to the number of lanes, allow for height of axis labels.
                // Uses hardcoded height for each lane of 32px, with the chart symbols having a height of 28px.
                element.height((laneIds.length * 32) + 50);

                // Draw the plot.
                const plot = $.plot(element, allSeries, options);

                // Draw crosshair
                const setNowCrosshair = function (intervalIndicator) {
                    const now = new Date();
                    // console.log("setNowCrosshair : update at " + now);
                    plot.lockCrosshair({x: now.getTime()});
                    if (!intervalIndicator) {
                        if (crossairRefreshTimer != null) {
                            // console.log("setNowCrosshair : cancel previous timer");
                            $interval.cancel(crossairRefreshTimer);
                        }
                        const elapseInMinutes = (plot.getAxes().xaxis.max - plot.getAxes().xaxis.min) / (1000 * 60);
                        const intervalInMinutes = elapseInMinutes > 120 ? (elapseInMinutes > 240 ? 5 : 1) : (elapseInMinutes < 60 ? 0.25 : 0.5);
                        // console.log("setNowCrosshair : interval in minutes is " + intervalInMinutes);
                        crossairRefreshTimer = $interval(function () {
                            setNowCrosshair(true);
                        }, 1000 * 60 * intervalInMinutes);
                    }
                };
                setNowCrosshair(false);
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

                // --------------------------------------------------------
                // FIXME Emmanuel GIRE => ce code ne fonctionne pas :

                // Add tooltips to the y-axis labels to display the full 'viewBy' field
                // - useful for cases where a long text value has been cropped.
                // NB. requires z-index set in CSS so that hover is picked up on label.
                const yAxisLabelDivs = $('.flot-y-axis', angular.element(element)).find('.flot-tick-label');
                _.each(laneIds, (labelId, i) => {
                    const labelText = labelId;
                    let labelDiv = $(yAxisLabelDivs[i]);
                    labelDiv.attr('title', labelText);
                    // console.log('DIV axisY : ' + labelDiv.title)
                    // console.log('$(yAxisLabelDivs['+i+']='+labelDiv.name);
                });
                // --------------------------------------------------------


                // Show tooltips on point hover.
                element.unbind('plothover');
                element.bind('plothover', (event, pos, item) => {

                    function sortLineLabels() {
                        scope.lineLabels = new Map([...scope.lineLabels.entries()].sort((labelEntry1, labelEntry2) => {
                            const label1 = labelEntry1[1];
                            const label2 = labelEntry2[1];
                            if (label1 < label2) return -1;
                            if (label1 > label2) return 1;
                            return 0;
                        }))
                    }

                    if (item) {
                        element.addClass('prl-swimlane-vis-point-over ');
                        if (scope._previousHoverPoint !== item.dataIndex) {
                            scope._previousHoverPoint = item.dataIndex;
                            $('.prl-swimlane-vis-tooltip').remove();
                            if (scope._influencerHoverScope) {
                                scope._influencerHoverScope.$destroy();
                            }

                            const hoverLaneIndex = item.series.data[item.dataIndex][1] - 0.5;
                            let currentIcaoCarrierCode;
                            sortLineLabels();
                            let icaoCodes = scope.lineLabels.keys();

                            // Reverse the keys as the lanes are rendered bottom up.
                            let keys = Array.from(icaoCodes).reverse();

                            for (var lineHeaderIndex = 0; lineHeaderIndex < keys.length; lineHeaderIndex++) {
                                if (lineHeaderIndex === hoverLaneIndex) {
                                    currentIcaoCarrierCode = keys[lineHeaderIndex];
                                    break;
                                }
                            }

                            // const laneLabel = laneIds[hoverLaneIndex];
                            const laneLabel = scope.lineLabels.get(currentIcaoCarrierCode);
                            showTooltip(item, laneLabel);
                        }
                    } else {
                        element.removeClass('prl-swimlane-vis-point-over ');
                        // $('.prl-swimlane-vis-tooltip').fadeOut(400);
                        $('.prl-swimlane-vis-tooltip').remove();
                        scope._previousHoverPoint = null;
                        if (scope._influencerHoverScope) {
                            scope._influencerHoverScope.$destroy();
                        }
                    }
                });

                // Set the Kibana timefilter if the user selects a range on the chart.
                element.unbind('plotselected');
                element.bind('plotselected', (event, ranges) => {
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
                    timefilter.update();

                });
                element.unbind('plotclick');
                element.bind('plotclick', function (event, ranges, item) {
                    // if the item is null then the user didn't click on a rectangle, it is probably a resize, so we just don't do anything
                    if (item !== null) {
                        // objectId extraction
                        const pointTime = item.datapoint[0];
                        const hoverLaneIndex = item.series.data[item.dataIndex][1] - 0.5;
                        const carrierCode = laneIds[hoverLaneIndex];
                        const worstFlight = extractWorstFlight(pointTime, scope.agg, scope.additionalSimultaneousFlights, carrierCode);
                        // const objectId = formattedDate + "_" + carrierCode + worstFlight.currentFlightNumber + "_" + worstFlight.departureStation ;
                        const objectId = worstFlight.iataObjectId;
                        // const formattedDate = moment(pointTime).format('YYYYMMDD');
                        if (objectId !== 'null') {
                            $window.open(scope.vis.params.apiPnrBaseUrl + '/#/message?objectId=' + objectId, '_blank');
                        }
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
            function extractFlights(pointTime, carrierCodeAggs, additionalSimultaneousFlights, carrierCode) {
                // console.log('*************************************** extractFlights : pointTime=' + pointTime)
                let simultaneousFlights = [];
                _.each(carrierCodeAggs, function (carrierCodeAgg) {
                    _.each(carrierCodeAgg['3'].buckets, function (bucket) {
                        if (bucket.displayKey === carrierCode) {
                            if (bucket.key === pointTime) {
                                // console.log('bucket added to simultaneousFlights:' + bucket.currentFlightNumber + '/key=' + bucket.key);
                                simultaneousFlights.push(bucket);
                            }
                        }
                    });
                });
                return simultaneousFlights;
            }

            /**
             *
             * @param pointTime
             * @param carrierCodeAggs
             * @param additionalSimultaneousFlights
             * @param carrierCode
             * @returns {*}
             */
            function extractWorstFlight(pointTime, carrierCodeAggs, additionalSimultaneousFlights, carrierCode) {
                let simultaneousFlights = extractFlights(pointTime, carrierCodeAggs, additionalSimultaneousFlights, carrierCode);
                let worstFlight = simultaneousFlights [0];
                _.each(simultaneousFlights, function (flight) {
                    if (flight['1'].value > worstFlight['1'].value) {
                        worstFlight = flight;
                    }
                });
                return worstFlight;
            }

            /**
             *
             * @param item
             * @param laneLabel
             */
            function showTooltip(item, laneLabel) {
                const pointTime = item.datapoint[0];
                // const dataModel = item.series.data[item.dataIndex][2];
                // const metricsAgg = scope.vis.aggs.bySchemaName.metric[0];
                // const metricLabel = metricsAgg.makeLabel();
                // const displayScore = numeral(dataModel.score).format(scope.vis.params.tooltipNumberFormat);
                // Display date using dateFormat configured in Kibana settings.
                // const formattedDate = moment(pointTime).format('HH:mm');
                const simultaneousFlights = extractFlights(pointTime, scope.agg, scope.additionalSimultaneousFlights, laneLabel);
                let contents = '';
                _.each(simultaneousFlights, function (flight) {

                    if (flight.iataCarrierCode !== undefined) {
                        contents += flight.iataCarrierCode
                        if (flight.iataFlightNumber !== undefined) {
                            contents += flight.iataFlightNumber
                        }
                        contents += ' / '
                    }
                    contents += flight.carrierCode + flight.currentFlightNumber;
                    if (flight.routing !== undefined) {
                        contents += ' (' + flight.routing + ')';
                    }
                    contents += '<hr> ';

                    if (flight.pnrPush !== undefined) {
                        contents += 'Push PNR : ' + flight.pnrPush
                        contents += '<br/>';
                    }
                    if (flight.apiPush !== undefined) {
                        contents += 'Push API : ' + flight.apiPush
                        contents += '<br/>';
                    }

                    // contents +=
                    contents += receptionStatusLabel(flight['1'].value);
                    if (flight.atdGmt !== undefined) {
                        contents += '<br/>ATD : ' + flight.atdGmt;

                    } else if (flight.etdGmt !== undefined) {
                        contents += '<br/>ETD : ' + flight.etdGmt;
                    }
                    if (flight.flightState !== undefined) {
                        if (flight.flightState == 'TERMINATED') {
                            contents += '<br/>' + 'Landed';
                            if (flight.ataGmt !== undefined) {
                                contents += ' - ATA : ' + flight.ataGmt;
                            }
                        }
                    }

                    // contents += '<br/>';
                });
                // contents += ' ' + formattedDate;
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
                let $plot = $('.prl-swimlane-vis-tooltip');
                const width = $plot.outerWidth(true);
                const height = $plot.outerHeight(true);
                $plot.css('left', x + offset + width > $win.width() ? x - offset - width : x + offset);
                $plot.css('top', y + height < winHeight + yOffset ? y : y - height);

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
                    return "Cancelled";
                case 4:
                    return "On time";
                case 5:
                    return "Expected";
                case 6:
                    return "Delayed";
                case 7:
                    return "Missing";
            }
        }

        return {
            link: link
        };
    });