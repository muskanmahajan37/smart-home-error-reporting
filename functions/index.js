// Copyright 2019, Google, Inc.
// Licensed under the Apache License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const functions = require('firebase-functions');

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const settings = {timestampsInSnapshots: true};
db.settings(settings);

const COLLECTION_ERRORS = "errors";
const FieldValue = require('firebase-admin').firestore.FieldValue;

const express = require('express');
const app = express();
const cookieParser = require('cookie-parser')();
const bodyParser = require('body-parser');
app.use(bodyParser);
app.use(cookieParser);

// Original Stackdriver errors are generated by setting up the smarthome function
// and modifying the responses in order to have the desired effect. The functions
// are commented out as they are not needed in standard use of this sample. However, they
// are kept in the source code in the event that the original error messages need to be
// reconstructed.
const stackdriverErrors = {
  lart: "SYNC: Request ID 110000000000000000 update devices failed: INVALID_ARGUMENT. " +
    "Detail: Unknown Type [action.devices.types.LART] for device " +
    "[type: \"action.devices.types.LART\"\nsupported_traits: \"action.devices.traits.OnOff\"\n" +
    "agent_device_id {\n  agent_id: \"my-project-id\"\n  device_id: \"123\"\n}\n" +
    "device_info {\n  manufacturer: \"lights-out-inc\"\n  model: \"hs1234\"\n  hw_version: \"3.2\"\n" +
    "sw_version: \"11.4\"\n}\n\nagent_device_names {\n  name: \"Night light\"\n"+
    "nicknames: \"wall plug\"\n  default_names: \"My Outlet 1234\"\n}\n].",
  lightbulb: "SYNC: Request ID 110000000000000000 update devices failed: INVALID_ARGUMENT. " +
    "Detail: Unknown Type [action.devices.types.LIGHTBULB] for device " +
    "[type: \"action.devices.types.LIGHTBULB\"\nsupported_traits: \"action.devices.traits.OnOff\"\n" +
    "agent_device_id {\n  agent_id: \"my-project-id\"\n  device_id: \"123\"\n}\n" +
    "device_info {\n  manufacturer: \"lights-out-inc\"\n  model: \"hs1234\"\n  hw_version: \"3.2\"\n" +
    "sw_version: \"11.4\"\n}\n\nagent_device_names {\n  name: \"Night light\"\n"+
    "nicknames: \"wall plug\"\n  default_names: \"My Outlet 1234\"\n}\n].",
  offon: "SYNC: Request ID 110000000000000000 update devices failed: INVALID_ARGUMENT. " +
    "Detail: Unrecognized SupportedTraits: [action.devices.traits.OffOn] for device " +
    "[type: \"action.devices.types.LIGHT\"\nsupported_traits: \"action.devices.traits.OffOn\"\n" +
    "agent_device_id {\n  agent_id: \"smart-home-stackdriver\"\n  device_id: \"123\"\n}\n" +
    "device_info {\n  manufacturer: \"lights-out-inc\"\n  model: \"hs1234\"\n  hw_version: \"3.2\"\n" +
    "sw_version: \"11.4\"\n}\nagent_device_names {\n  name: \"Night light\"\n" +
    "nicknames: \"wall plug\"\n  default_names: \"My Outlet 1234\"\n}\n]",
  notraits: "SYNC: Request ID 5703506311100733653 update devices failed: INVALID_ARGUMENT. " +
    "Detail: No SupportedTraits for device " +
    "[type: \"action.devices.types.LIGHT\"\nagent_device_id {\n" +
    "agent_id: \"smart-home-stackdriver\"\n  device_id: \"123\"\n}\n" +
    "device_info {\n  manufacturer: \"lights-out-inc\"\n  model: \"hs1234\"\n  hw_version: \"3.2\"\n" +
    "sw_version: \"11.4\"\n}\nagent_device_names {\n  name: \"Night light\"\n" +
    "nicknames: \"wall plug\"\n  default_names: \"My Outlet 1234\"\n}\n]."
}

exports.stackdriver = functions.https.onRequest(async (request, response) => {
  if (!!request.body.message && !!request.body.message.data) {
    const data = Buffer.from(request.body.message.data, 'base64')
        .toString('utf8');
    const jsonData = JSON.parse(data);
    const type = jsonData.resource.type;
    const databasePayload = {
      rawError: data,
      timestamp: FieldValue.serverTimestamp(),
      sourceType: type,
    };
    // In production, you will only want to process errors that come directly from your action.
    // You can check the value of type and stop processing if from a different source.
    // Uncomment this snippet to enable that.
    /*
    if (type !== 'assistant_action') {
      response.status(500).send('Error is not from action');
      return;
    }
    */
    // Insert regexp here to find request id and failure reason
    const {textPayload} = jsonData;
    console.log(textPayload);
    const regexMatch = /(SYNC): Request ID (\d+) (.+?): (\w+). Detail: ([\w\s]+) \[((?:.|\n)*)\]/
    const matchedPayload = textPayload.match(regexMatch);
    console.log(matchedPayload);
    // If the match has 7 items, then we know that our match was successful.
    // Otherwise, just store raw data about the error
    if (matchedPayload && matchedPayload.length === 7) {
      databasePayload.intent = matchedPayload[1];
      databasePayload.requestId = matchedPayload[2];
      databasePayload.errorPrimary = matchedPayload[3];
      databasePayload.errorSecondary = matchedPayload[4];
      databasePayload.errorTertiary = matchedPayload[5];
      databasePayload.errorParameters = matchedPayload[6];
    }

    await db.collection(COLLECTION_ERRORS).add(databasePayload)
    response.status(204).send('Success');
    return
  }
  response.status(500).send('Unexpected error occurred');
});

// GET /errors?error=type,trait,...
exports.errors = functions.https.onRequest((request, response) => {
  const errorMessages = []
  const errorKeys = request.query.error.split(',');
  for (const key of errorKeys) {
    // Send error message, which will be processed by Stackdriver
    // This will then trigger a message to /stackdriver
    const stackDriverError = stackdriverErrors[key];
    console.error(stackDriverError);
    errorMessages.push(stackDriverError);
  }
  response.status(200).send(`${errorMessages.join('\n\n')}`);
});

// Uncomment these lines to enable the functions for smart home
// const {smarthome, fakeauth, faketoken} = require('./smarthome-action');
// exports.smarthome = smarthome;
// exports.fakeauth = fakeauth;
// exports.faketoken = faketoken;