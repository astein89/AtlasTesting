## submitMission

	### POST:

	http://<SERVER_IP>:<SERVER_PORT>/api/amr/submitMission

	Content-Type: application/json
	Authorization: AUTH_KEY

	{
		"orgId": "DCAuto",
		"requestId": "testmisson123",
		"missionCode": "testmisson123",
		"missionType": "RACK_MOVE",
		"robotType": "LIFT",
		"lockRobotAfterFinish": "",
		"unlockRobotId": "",
		"robotModels": [
			"KMP 600P-EU-D diffDrive",
			"KMP 1500P-EU-D diffDrive"
		],
		"robotIds": [
			"1",
			"2",
			"3"
		],
		"missionData": [
		{
			"sequence":1,
			"position": "S1-AMR-01",
			"type":"NODE_POINT",
			"passStrategy":"AUTO",
			"waitingMillis":0,
			"putDown":false},

			{"sequence":2,
			"position": "PD-AMR-01",
			"type":"NODE_POINT",
			"passStrategy":"AUTO",
			"waitingMillis":0,
			"putDown":true}
			]
	}

	#### JSON OPTIONS:  *not listed below, needs to be as listed in example*
		orgID:
			- pull from settings page
		requestId:
			- Unique ID
			- DCA-RM-YYYYMMDD-{SQIDS}
		missionCode:
			- same as requestId
		robotType:
			- pull from settings page
		lockRobotAfterFinish:
		unlockRobotId:
			- ID of robot if previously locked to a mission
		robotModels:
			- pull from settings page
		robotIds:
			- can be blank, or a list
			- allow selection from list of active robots from robotQuery
		missionData:
			sequence: 
				- order of task operation 1 would be start point, 2 would be destination
				- can have multiple locations to create a hold task for AMR
			position: 
				- "External Code" select from list
			passStrategy: 
				- AUTO: Automatically goes to next sequence, waits for waitingMillis first
				- MANUAL: 
			waitingMillis: 
				- time in millisesconds that AMR will wait untill executing next sequence
				- required when providing passStrategy

	### RESPONSE:

	{
		"data": null,
		"code": "100001",
		"message": "java.lang.NullPointerException",
		"success": false
	}

	### HEADERS:

	Access-Control-Expose-Headers: *
	Access-Control-Allow-Origin: *
	Access-Control-Allow-Credentials: true
	Access-Control-Allow-Methods: *
	Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	Vary: Origin
	Vary: Access-Control-Request-Method
	Vary: Access-Control-Request-Headers
	Content-Type: application/json
	Transfer-Encoding: chunked
	Date: Fri, 01 May 2026 21:12:59 GMT

	### CONSOLE:

	* Preparing request to http://<SERVER_IP>:<SERVER_PORT>/api/amr/submitMission
	* Current time is 2026-05-01T21:13:02.445Z
	* Enable automatic URL encoding
	* Using default HTTP version
	* Enable timeout of 30000ms
	* Enable SSL validation
	* Hostname in DNS cache was stale, zapped
	*   Trying <SERVER_IP>:<SERVER_PORT>...
	* Connected to <SERVER_IP> (<SERVER_IP>) port <SERVER_PORT> (#1)

	> POST /api/amr/submitMission HTTP/1.1
	> Host: <SERVER_IP>:<SERVER_PORT>
	> Authorization: AUTH_KEY
	> Content-Type: application/json
	> Accept: */*
	> Content-Length: 703

	| {
	|     "orgId": "DCAuto",
	| 	  "requestId": "testmisson123",
	| 	  "missionCode": "testmisson123",
	|     "missionType": "RACK_MOVE",
	|     "robotType": "LIFT",
	|     "lockRobotAfterFinish": "",
	|     "unlockRobotId": "",
	|     "robotModels": [
	| 			"KMP 600P-EU-D diffDrive",
	| 			"KMP 1500P-EU-D diffDrive"
	| 		],
	| 		"robotIds": [
	| 			"1",
	| 			"2",
	| 			"3"
	| 		],
	|     "missionData": [
	|     {
	|         "sequence":1,
	|         "position": "S1-AMR-01",
	|         "type":"NODE_POINT",
	|         "passStrategy":"AUTO",
	|         "waitingMillis":0,
	|         "putDown":false},
	|         {"sequence":2,
	|         "position": "PD-AMR-01",
	|         "type":"NODE_POINT",
	|         "passStrategy":"AUTO",
	|         "waitingMillis":0,
	|         "putDown":true}
	| 		]
	| }

	* Mark bundle as not supporting multiuse

	< HTTP/1.1 200 
	< Access-Control-Expose-Headers: *
	< Access-Control-Allow-Origin: *
	< Access-Control-Allow-Credentials: true
	< Access-Control-Allow-Methods: *
	< Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	< Vary: Origin
	< Vary: Access-Control-Request-Method
	< Vary: Access-Control-Request-Headers
	< Content-Type: application/json
	< Transfer-Encoding: chunked
	< Date: Fri, 01 May 2026 21:12:59 GMT


	* Received 99 B chunk
	* Connection #1 to host <SERVER_IP> left intact
	
## missionCancel

	### POST:

	http://<SERVER_IP>:<SERVER_PORT>/api/amr/missionCancel

	Content-Type: application/json
	Authorization: AUTH_KEY

	{
		"requestId": "CANtestmisson133",
		"missionCode": "testmisson133",
		"cancelMode": "NORMAL"
	}

	#### JSON OPTIONS:  *not listed below, needs to be as listed in example*
		- requestId:
			- Unique ID
			- DCA-CN-YYYYMMDD-{SQIDS}
		- missionCode:
			- Mission ID to cancel
		- cancelMode:
			- FORCE
				- Force cancel,immediately terminate the current mission.
			- NORMAL
				- Normal cancel, does not cancel the task the robot is executing, waits for the robot to complete the current task before canceling the workflow.
			- REDIRECT_END
				- Redirect to the end node of the workflow, does not cancel the task the robot is executing, waits for the robot to complete the current task. If the target node does not require lowering the rack, the vehicle carries the rack to the end node; otherwise, the empty robot moves to the end node.
			- REDIRECT_START
				Redirect to the start node of the workflow, does not cancel the task the robot is executing, waits for the robot to complete the current task. If the target node does not require lowering
		
	### RESPONSE:

	{
		"data": null,
		"code": "0",
		"message": null,
		"success": true
	}

	### HEADERS:

	Access-Control-Expose-Headers: *
	Access-Control-Allow-Origin: *
	Access-Control-Allow-Credentials: true
	Access-Control-Allow-Methods: *
	Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	Vary: Origin
	Vary: Access-Control-Request-Method
	Vary: Access-Control-Request-Headers
	Content-Type: application/json
	Transfer-Encoding: chunked
	Date: Sun, 03 May 2026 00:58:30 GMT

	### CONSOLE:

	* Preparing request to http://<SERVER_IP>:<SERVER_PORT>/api/amr/missionCancel
	* Current time is 2026-05-03T00:58:32.939Z
	* Enable automatic URL encoding
	* Using default HTTP version
	* Enable timeout of 30000ms
	* Enable SSL validation
	* Found bundle for host: 0x1a2233c6810 [serially]
	* Can not multiplex, even if we wanted to
	* Re-using existing connection #33 with host <SERVER_IP>
	* Connected to <SERVER_IP> (<SERVER_IP>) port <SERVER_PORT> (#33)

	> POST /api/amr/missionCancel HTTP/1.1
	> Host: <SERVER_IP>:<SERVER_PORT>
	> Authorization: AUTH_KEY
	> Content-Type: application/json
	> Accept: */*
	> Content-Length: 94

	| {
	| 	"requestId": "CANtestmisson133",
	| 	"missionCode": "testmisson133",
	| 	"cancelMode": "NORMAL"
	| }

	* Mark bundle as not supporting multiuse

	< HTTP/1.1 200 
	< Access-Control-Expose-Headers: *
	< Access-Control-Allow-Origin: *
	< Access-Control-Allow-Credentials: true
	< Access-Control-Allow-Methods: *
	< Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	< Vary: Origin
	< Vary: Access-Control-Request-Method
	< Vary: Access-Control-Request-Headers
	< Content-Type: application/json
	< Transfer-Encoding: chunked
	< Date: Sun, 03 May 2026 00:58:30 GMT


	* Received 60 B chunk
	* Received 5 B chunk
	* Connection #33 to host <SERVER_IP> left intact

	### Response status:

	200	OK	Response
	201	Created	
	401	Unauthorized	
	403	Forbidden	
	404	Not Found
	
## operationFeedback


	### POST:


	http://<SERVER_IP>:<SERVER_PORT>/api/amr/operationFeedback


	Content-Type: application/json
	Authorization: AUTH_KEY


	{
	"requestId": "releasetestmisson140",
	"missionCode": "testmisson140"
	}


	#### JSON OPTIONS:  *not listed below, needs to be as listed in example*
		- requestId:
			- Unique ID
			- DCA-CN-YYYYMMDD-{SQIDS}
		- missionCode:
			- Mission ID to resume
		
	### RESPONSE:


	{
		"data": null,
		"code": "0",
		"message": null,
		"success": true
	}


	### HEADERS:


	Access-Control-Expose-Headers: *
	Access-Control-Allow-Origin: *
	Access-Control-Allow-Credentials: true
	Access-Control-Allow-Methods: *
	Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	Vary: Origin
	Vary: Access-Control-Request-Method
	Vary: Access-Control-Request-Headers
	Content-Type: application/json
	Transfer-Encoding: chunked
	Date: Sun, 03 May 2026 22:15:31 GMT


	### CONSOLE:


	* Preparing request to http://<SERVER_IP>:<SERVER_PORT>/api/amr/operationFeedback
	* Current time is 2026-05-03T22:15:35.321Z
	* Enable automatic URL encoding
	* Using default HTTP version
	* Enable timeout of 30000ms
	* Enable SSL validation
	* Connection 0 seems to be dead
	* Closing connection 0
	* Hostname in DNS cache was stale, zapped
	*   Trying <SERVER_IP>:<SERVER_PORT>...
	* Connected to <SERVER_IP> (<SERVER_IP>) port <SERVER_PORT> (#1)


	> POST /api/amr/operationFeedback HTTP/1.1
	> Host: <SERVER_IP>:<SERVER_PORT>
	> Authorization: AUTH_KEY
	> Content-Type: application/json
	> Accept: */*
	> Content-Length: 71


	| {
	| "requestId": "releasetestmisson140",
	| "missionCode": "testmisson140"
	| }


	* Mark bundle as not supporting multiuse


	< HTTP/1.1 200 
	< Access-Control-Expose-Headers: *
	< Access-Control-Allow-Origin: *
	< Access-Control-Allow-Credentials: true
	< Access-Control-Allow-Methods: *
	< Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	< Vary: Origin
	< Vary: Access-Control-Request-Method
	< Vary: Access-Control-Request-Headers
	< Content-Type: application/json
	< Transfer-Encoding: chunked
	< Date: Sun, 03 May 2026 22:15:31 GMT




	* Received 65 B chunk
	* Connection #1 to host <SERVER_IP> left intact


	### Response status:


	200	OK	Response
	201	Created	
	401	Unauthorized	
	403	Forbidden	
	404	Not Found


## robotQuery

	### POST:

	http://<SERVER_IP>:<SERVER_PORT>/api/amr/robotQuery

	Content-Type: application/json
	Authorization: AUTH_KEY

	{
		"robotId": "",
		"robotType": ""
	}

	JSON OPTIONS:  *not listed below, needs to be as listed in example*
		- robotId
			- can be blank to return all
			- can specify a particular AMR by robotID
		- robotType
			- can be blank to return all
			- selectable list of robotType from settings 

	### RESPONSE:
	200 OK

	{
		"data": [
			{
				"robotId": "8506865",
				"robotType": "KMP 1500P-EU-D diffDrive",
				"mapCode": "Main",
				"floorNumber": "Main",
				"buildingCode": "Salem",
				"containerCode": "",
				"status": 1,
				"occupyStatus": 0,
				"batteryLevel": 100.0,
				"nodeCode": "Main-Main-4",
				"nodeLabel": "4",
				"nodeNumber": 4,
				"x": "0.0",
				"y": "0.0",
				"robotOrientation": "0.0",
				"liftStatus": 0,
				"reliability": 0,
				"runTime": "0",
				"karOsVersion": "",
				"mileage": "0.0",
				"leftMotorTemperature": "0.0",
				"rightMotorTemperature": "0.0",
				"rotateMotorTemperature": "0.0",
				"liftMtrTemp": "0.0",
				"leftFrtMovMtrTemp": "0.0",
				"rightFrtMovMtrTemp": "0.0",
				"leftReMovMtrTemp": "0.0",
				"rightReMovMtrTemp": "0.0",
				"rotateTimes": 0,
				"liftTimes": 0,
				"nodeForeignCode": "S1-AMR-03"
			},
			{
				"robotId": "1",
				"robotType": "KMP 1500P-EU-D diffDrive",
				"mapCode": "Main",
				"floorNumber": "Main",
				"buildingCode": "Salem",
				"containerCode": "",
				"status": 3,
				"occupyStatus": 0,
				"batteryLevel": 92.0,
				"nodeCode": "Main-Main-995",
				"nodeLabel": "995",
				"nodeNumber": 995,
				"x": "196802.0",
				"y": "158450.0",
				"robotOrientation": "180.0",
				"liftStatus": 0,
				"reliability": 1,
				"runTime": "127040",
				"karOsVersion": "",
				"mileage": "0.0",
				"leftMotorTemperature": "0.0",
				"rightMotorTemperature": "0.0",
				"rotateMotorTemperature": "0.0",
				"liftMtrTemp": "0.0",
				"leftFrtMovMtrTemp": "0.0",
				"rightFrtMovMtrTemp": "0.0",
				"leftReMovMtrTemp": "0.0",
				"rightReMovMtrTemp": "0.0",
				"rotateTimes": 0,
				"liftTimes": 0,
				"nodeForeignCode": "",
				"errorMessage": " noError-idle"
			}
		],
		"code": "0",
		"message": null,
		"success": true
	}


	### HEADERS:

	Access-Control-Expose-Headers: *
	Access-Control-Allow-Origin: *
	Access-Control-Allow-Credentials: true
	Access-Control-Allow-Methods: *
	Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	Vary: Origin
	Vary: Access-Control-Request-Method
	Vary: Access-Control-Request-Headers
	Content-Type: application/json
	Transfer-Encoding: chunked
	Date: Sat, 02 May 2026 23:22:30 GMT

	### CONSOLE:

	* Preparing request to http://<SERVER_IP>:<SERVER_PORT>/api/amr/robotQuery
	* Current time is 2026-05-02T23:22:34.626Z
	* Enable automatic URL encoding
	* Using default HTTP version
	* Enable timeout of 30000ms
	* Enable SSL validation
	* Too old connection (219 seconds idle), disconnect it
	* Connection 8 seems to be dead
	* Closing connection 8
	* Hostname in DNS cache was stale, zapped
	*   Trying <SERVER_IP>:<SERVER_PORT>...
	* Connected to <SERVER_IP> (<SERVER_IP>) port <SERVER_PORT> (#9)

	> POST /api/amr/robotQuery HTTP/1.1
	> Host: <SERVER_IP>:<SERVER_PORT>
	> Authorization: AUTH_KEY
	> Content-Type: application/json
	> Accept: */*
	> Content-Length: 36

	| {
	| 	"robotId": "",
	| 	"robotType": ""
	| }

	* Mark bundle as not supporting multiuse

	< HTTP/1.1 200 
	< Access-Control-Expose-Headers: *
	< Access-Control-Allow-Origin: *
	< Access-Control-Allow-Credentials: true
	< Access-Control-Allow-Methods: *
	< Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	< Vary: Origin
	< Vary: Access-Control-Request-Method
	< Vary: Access-Control-Request-Headers
	< Content-Type: application/json
	< Transfer-Encoding: chunked
	< Date: Sat, 02 May 2026 23:22:30 GMT


	* Received 8.7 KB chunk
	* Received 2.5 KB chunk
	* Received 838 B chunk
	* Connection #9 to host <SERVER_IP> left intact

	### ROBOT STATUS:

	Departure: 1
	Offline: 2
	Idle: 3
	Executing: 4
	Charging: 5
	Updating:6
	Abnormal: 7

	### Response status:

	200	OK
	201	Created	
	401	Unauthorized	
	403	Forbidden	
	404	Not Found
	
## jobQuery

	### POST:
	http://<SERVER_IP>:<SERVER_PORT>/api/amr/jobQuery

	Content-Type: application/json
	Authorization: AUTH_KEY

	{
		"jobCode": "testmisson125"
	}

	#### JSON OPTIONS:  *not listed below, needs to be as listed in example*
		- jobCode:
			- Blank returns all active jobs
			- jobCode from submitMission to track status
				- use configurable check time in settings

	### RESPONSE:

	{
		"data": [
			{
				"jobCode": "testmisson125",
				"workflowId": 497,
				"containerCode": "PG12345678",
				"robotId": "1",
				"status": 30,
				"workflowName": null,
				"workflowCode": null,
				"workflowPriority": 1,
				"mapCode": "Main",
				"targetCellCode": "Main-Main-1000",
				"beginCellCode": "Main-Main-6",
				"targetCellCodeForeign": "PD-AMR-01",
				"beginCellCodeForeign": "S1-AMR-01",
				"finalNodeCode": "Main-Main-1000",
				"warnFlag": 0,
				"warnCode": null,
				"completeTime": "2026-05-01 14:53:42",
				"spendTime": 49,
				"createUsername": null,
				"createTime": "2026-05-01 14:52:53",
				"source": "DCAuto",
				"materialsInfo": "-"
			}
		],
		"code": null,
		"message": null,
		"success": true
	}

	### HEADERS:

	Access-Control-Expose-Headers: *
	Access-Control-Allow-Origin: *
	Access-Control-Allow-Credentials: true
	Access-Control-Allow-Methods: *
	Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	Vary: Origin
	Vary: Access-Control-Request-Method
	Vary: Access-Control-Request-Headers
	Content-Type: application/json
	Transfer-Encoding: chunked
	Date: Fri, 01 May 2026 21:53:56 GMT

	### CONSOLE:

	* Preparing request to http://<SERVER_IP>:<SERVER_PORT>/api/amr/jobQuery
	* Current time is 2026-05-01T21:53:59.032Z
	* Enable automatic URL encoding
	* Using default HTTP version
	* Enable timeout of 30000ms
	* Enable SSL validation
	* Found bundle for host: 0x1a21e543760 [serially]
	* Can not multiplex, even if we wanted to
	* Re-using existing connection #6 with host <SERVER_IP>
	* Connected to <SERVER_IP> (<SERVER_IP>) port <SERVER_PORT> (#6)

	> POST /api/amr/jobQuery HTTP/1.1
	> Host: <SERVER_IP>:<SERVER_PORT>
	> Authorization: AUTH_KEY
	> Content-Type: application/json
	> Accept: */*
	> Content-Length: 31

	| {
	| 	"jobCode": "testmisson125"
	| }

	* Mark bundle as not supporting multiuse

	< HTTP/1.1 200 
	< Access-Control-Expose-Headers: *
	< Access-Control-Allow-Origin: *
	< Access-Control-Allow-Credentials: true
	< Access-Control-Allow-Methods: *
	< Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	< Vary: Origin
	< Vary: Access-Control-Request-Method
	< Vary: Access-Control-Request-Headers
	< Content-Type: application/json
	< Transfer-Encoding: chunked
	< Date: Fri, 01 May 2026 21:53:56 GMT


	* Received 586 B chunk
	* Connection #6 to host <SERVER_IP> left intact


	### JOB STATUS:

	Created: 10
	Executing: 20
	Waiting: 25
	Cancelling: 28
	Complete: 30
	Cancelled: 31
	Manual complete: 35
	Warning: 50
	Startup error: 60


## containerin

	### POST:

	http://<SERVER_IP>:<SERVER_PORT>/api/amr/containerIn

	Content-Type: application/json
	Authorization: AUTH_KEY

	{
		"orgId": "DCAuto",
		"requestId": "test12345",
		"containerType":"Tray(AMR)",
		"containerModelCode": "Pallet",
		"position": "S1-AMR-01",
		"containerCode": "PG12345678",
		"enterOrientation": "0",
		"isNew":true
	}

	#### JSON OPTIONS:  *not listed below, needs to be as listed in example*
		- orgID:
			- pull from settings page
		- requestId:
			- Unique ID
			- DCA-CI-YYYYMMDD-{SQIDS}
		- position:
			- start location for mission
		- containerCode
			- optional, example should be the LPN of the pallet.
			- if not provided generate a 16 char UUID
		- enterOrientation
			- pull from node table, orientaion
			- allowed values: 0,90,180,-90

	### RESPONSE:

	200 OK

	{
		"data": "containerCode:PG12345678",
		"code": "0",
		"message": null,
		"success": true
	}

	### HEADERS:

	Access-Control-Expose-Headers: *
	Access-Control-Allow-Origin: *
	Access-Control-Allow-Credentials: true
	Access-Control-Allow-Methods: *
	Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	Vary: Origin
	Vary: Access-Control-Request-Method
	Vary: Access-Control-Request-Headers
	Content-Type: application/json
	Transfer-Encoding: chunked
	Date: Fri, 01 May 2026 19:30:03 GMT

	### CONSOLE:

	* Preparing request to http://<SERVER_IP>:<SERVER_PORT>/api/amr/containerIn
	* Current time is 2026-05-01T19:30:06.477Z
	* Enable automatic URL encoding
	* Using default HTTP version
	* Enable timeout of 30000ms
	* Enable SSL validation
	* Too old connection (539 seconds idle), disconnect it
	* Connection 0 seems to be dead
	* Closing connection 0
	* Hostname in DNS cache was stale, zapped
	*   Trying <SERVER_IP>:<SERVER_PORT>...
	* Connected to <SERVER_IP> (<SERVER_IP>) port <SERVER_PORT> (#1)

	> POST /api/amr/containerIn HTTP/1.1
	> Host: <SERVER_IP>:<SERVER_PORT>
	> Authorization: AUTH_KEY
	> Content-Type: application/json
	> Accept: */*
	> Content-Length: 249

	| {
	|     "orgId": "DCAuto",
	|     "containerType":"Tray(AMR)",
	|     "containerModelCode": "Pallet",
	|     "position": "S1-AMR-01",
	|     "containerCode": "PG12345678",
	|     "requestId": "test12345",
	|     "enterOrientation": "0",
	|     "isNew":true
	| }


	* Mark bundle as not supporting multiuse

	< HTTP/1.1 200 
	< Access-Control-Expose-Headers: *
	< Access-Control-Allow-Origin: *
	< Access-Control-Allow-Credentials: true
	< Access-Control-Allow-Methods: *
	< Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	< Vary: Origin
	< Vary: Access-Control-Request-Method
	< Vary: Access-Control-Request-Headers
	< Content-Type: application/json
	< Transfer-Encoding: chunked
	< Date: Fri, 01 May 2026 19:30:03 GMT


	* Received 87 B chunk
	* Connection #1 to host <SERVER_IP> left intact


	### Response status:

	200	OK	Response
	201	Created	
	401	Unauthorized	
	403	Forbidden	
	404	Not Found
	
## ContainerOut

	### POST:

	http://<SERVER_IP>:<SERVER_PORT>/api/amr/containerOut

	Content-Type: application/json
	Authorization: AUTH_KEY



	{
		"requestId": "PG12345678",
		"containerType":"Tray(AMR)",
		"position": "S1-AMR-01",
		"isDelete":true
	}

	#### JSON OPTIONS:  *not listed below, needs to be as listed in example*
		- requestId:
			- Unique ID
			- DCA-CO-YYYYMMDD-{SQIDS}
		- position:
			- end location for mission
			- if more than a 2 sequence mission, use the very last
			
		
	### RESPONSE:

	{
		"data": null,
		"code": "0",
		"message": null,
		"success": true
	}

	### HEADERS:

	Access-Control-Expose-Headers: *
	Access-Control-Allow-Origin: *
	Access-Control-Allow-Credentials: true
	Access-Control-Allow-Methods: *
	Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	Vary: Origin
	Vary: Access-Control-Request-Method
	Vary: Access-Control-Request-Headers
	Content-Type: application/json
	Transfer-Encoding: chunked
	Date: Fri, 01 May 2026 19:33:44 GMT

	### CONSOLE:


	* Preparing request to http://<SERVER_IP>:<SERVER_PORT>/api/amr/containerOut
	* Current time is 2026-05-01T19:33:47.264Z
	* Enable automatic URL encoding
	* Using default HTTP version
	* Enable timeout of 30000ms
	* Enable SSL validation
	* Hostname <SERVER_IP> was found in DNS cache
	*   Trying <SERVER_IP>:<SERVER_PORT>...
	* Connected to <SERVER_IP> (<SERVER_IP>) port <SERVER_PORT> (#3)

	> POST /api/amr/containerOut HTTP/1.1
	> Host: <SERVER_IP>:<SERVER_PORT>
	> Authorization: AUTH_KEY
	> Content-Type: application/json
	> Accept: */*
	> Content-Length: 205

	| {
	|     "orgId":"DCAuto",
	|     "containerType":"Tray(AMR)",
	|     "containerModelCode": "Pallet",
	|     "position": "S1-AMR-01",
	|     "requestId": "PG12345678",
	|     "enterOrientation": "0",
	|     "isDelete":true
	| }

	* Mark bundle as not supporting multiuse

	< HTTP/1.1 200 
	< Access-Control-Expose-Headers: *
	< Access-Control-Allow-Origin: *
	< Access-Control-Allow-Credentials: true
	< Access-Control-Allow-Methods: *
	< Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	< Vary: Origin
	< Vary: Access-Control-Request-Method
	< Vary: Access-Control-Request-Headers
	< Content-Type: application/json
	< Transfer-Encoding: chunked
	< Date: Fri, 01 May 2026 19:33:44 GMT


	* Received 65 B chunk
	* Connection #3 to host <SERVER_IP> left intact


	### Response status:

	200	OK	Response
	201	Created	
	401	Unauthorized	
	403	Forbidden	
	404	Not Found
	
## ContainerOut

	### POST:

	http://<SERVER_IP>:<SERVER_PORT>/api/amr/containerQuery

	Content-Type: application/json
	Authorization: AUTH_KEY

	{
		"containerCode": "",
		"nodeCode": ""
	}

	#### JSON OPTIONS:  *not listed below, needs to be as listed in example*
		containerCode:
			- can be blank to retrieve all containers in the map
			- specific containerCode to get information on
		- nodeCode:
			- can be blank to retrieve all containers in the map
			- specific nodeCode/position to get what container is located there
		
	### RESPONSE:

	{
		"data": [
			{
				"containerCode": "PALLET_STACK_03",
				"nodeCode": "S3-AMR-04",
				"orientation": "179.38",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "PALLET_STACK_02",
				"nodeCode": "S3-AMR-05",
				"orientation": "179.46",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ps-1",
				"nodeCode": "PF-AMR-02",
				"orientation": "-89.89",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ps-2",
				"nodeCode": "PC-AMR-14",
				"orientation": "-0.3",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ps-3",
				"nodeCode": "PF-AMR-01",
				"orientation": "90.01",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ATLAS_Spares",
				"nodeCode": "PA-AMR-11",
				"orientation": "90.03",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "PALLET_STACK_01",
				"nodeCode": "S3-AMR-06",
				"orientation": "179.49",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			}
		],
		"code": "0",
		"message": null,
		"success": true
	}

	### HEADERS:

	Access-Control-Expose-Headers: *
	Access-Control-Allow-Origin: *
	Access-Control-Allow-Credentials: true
	Access-Control-Allow-Methods: *
	Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	Vary: Origin
	Vary: Access-Control-Request-Method
	Vary: Access-Control-Request-Headers
	Content-Type: application/json
	Transfer-Encoding: chunked
	Date: Sat, 02 May 2026 23:36:20 GMT

	### CONSOLE:

	* Preparing request to http://<SERVER_IP>:<SERVER_PORT>/api/amr/containerQuery
	* Current time is 2026-05-02T23:36:22.761Z
	* Enable automatic URL encoding
	* Using default HTTP version
	* Enable timeout of 30000ms
	* Enable SSL validation
	* Connection 11 seems to be dead
	* Closing connection 11
	* Hostname in DNS cache was stale, zapped
	*   Trying <SERVER_IP>:<SERVER_PORT>...
	* Connected to <SERVER_IP> (<SERVER_IP>) port <SERVER_PORT> (#12)

	> POST /api/amr/containerQuery HTTP/1.1
	> Host: <SERVER_IP>:<SERVER_PORT>
	> Authorization: AUTH_KEY
	> Content-Type: application/json
	> Accept: */*
	> Content-Length: 68

	| {
	| 	"containerCode": "",
	| 	"containerModelCode": "",
	| 	"nodeCode": ""
	| }

	* Mark bundle as not supporting multiuse

	< HTTP/1.1 200 
	< Access-Control-Expose-Headers: *
	< Access-Control-Allow-Origin: *
	< Access-Control-Allow-Credentials: true
	< Access-Control-Allow-Methods: *
	< Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	< Vary: Origin
	< Vary: Access-Control-Request-Method
	< Vary: Access-Control-Request-Headers
	< Content-Type: application/json
	< Transfer-Encoding: chunked
	< Date: Sat, 02 May 2026 23:36:20 GMT


	* Received 1710 B chunk
	* Connection #12 to host <SERVER_IP> left intact

	### Response status:

	200	OK	Response
	201	Created	
	401	Unauthorized	
	403	Forbidden	
	404	Not Found
	
## containerQueryAll

	### POST:

	http://<SERVER_IP>:<SERVER_PORT>/api/amr/containerQueryAll

	Content-Type: application/json
	Authorization: AUTH_KEY

	{
		"containerCode": "",
		"nodeCode": "",
		"inMapStatus": ""
	}

	#### JSON OPTIONS:  *not listed below, needs to be as listed in example*
		containerCode:
			- can be blank to retrieve all containers in the map
			- specific containerCode to get information on
		- nodeCode:
			- can be blank to retrieve all containers in the map
			- specific nodeCode/position to get what container is located there
		- inMapStatus:
			- Can be blank to return all containers
			- 0
				- returns not inMap only
			- 1
				- returns inMap only

	### RESPONSE:

	{
		"data": [
			{
				"containerCode": "MISSION-20260421-47b831da",
				"nodeCode": "Main-Main-131",
				"orientation": "90.22",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ad94e55f6f62151a",
				"nodeCode": "Main-Main-853",
				"orientation": "-89.76",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260421-78108eaa",
				"nodeCode": "Main-Main-131",
				"orientation": "89.28",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260421-e064ef56",
				"nodeCode": "Main-Main-131",
				"orientation": "89.48",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "CA00000003",
				"nodeCode": "Main-Main-933",
				"orientation": "90.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260421-82668c5a",
				"nodeCode": "Main-Main-131",
				"orientation": "90.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260428-3901c699",
				"nodeCode": "Main-Main-110",
				"orientation": "179.89",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "PG12345678",
				"nodeCode": "Main-Main-6",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ATest2",
				"nodeCode": "Main-Main-131",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 1,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260423-3be5b603",
				"nodeCode": "Main-Main-952",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260421-c56e7815",
				"nodeCode": "Main-Main-131",
				"orientation": "-90.23",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260424-31c6540d",
				"nodeCode": "Main-Main-51",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "aa1176cf6bb7f349",
				"nodeCode": "Main-Main-932",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "d5d96761c9a09cbd",
				"nodeCode": "Main-Main-932",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "30cdc56b03d4ac77",
				"nodeCode": "Main-Main-853",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "f47bca3ff10b228b",
				"nodeCode": "Main-Main-932",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "04ba0496deb3a9cd",
				"nodeCode": "Main-Main-851",
				"orientation": "-90.1",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260421-a16b0293",
				"nodeCode": "Main-Main-131",
				"orientation": "-90.51",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "2a0ba8548f337965",
				"nodeCode": "Main-Main-932",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "PALLET_STACK_03",
				"nodeCode": "Main-Main-118",
				"orientation": "179.38",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "4d21d1ece8338ebc",
				"nodeCode": "Main-Main-932",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "54f3cac30b77d9c5",
				"nodeCode": "Main-Main-933",
				"orientation": "179.22",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260421-442f477b",
				"nodeCode": "Main-Main-131",
				"orientation": "-91.05",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "c4576290408874e1",
				"nodeCode": "Main-Main-853",
				"orientation": "-89.9",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "311e673b4ec03c60",
				"nodeCode": "Main-Main-853",
				"orientation": "-90.12",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "8758c674c0fc8d80",
				"nodeCode": "Main-Main-512",
				"orientation": "-178.95",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "PSTACK1",
				"nodeCode": "Main-Main-855",
				"orientation": "-89.82",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "PSTACK2",
				"nodeCode": "Main-Main-854",
				"orientation": "-0.01",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "PALLET_STACK_02",
				"nodeCode": "Main-Main-117",
				"orientation": "179.46",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260428-57e1d9b0",
				"nodeCode": "Main-Main-847",
				"orientation": "-0.47",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260428-506f3e98",
				"nodeCode": "Main-Main-845",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "Tray(AMR)",
				"nodeCode": "Main-Main-6",
				"orientation": "0.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260420-a50fd939",
				"nodeCode": "Main-Main-131",
				"orientation": "180.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "test",
				"nodeCode": "Main-Main-855",
				"orientation": "179.46",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "MISSION-20260424-b65be6c1",
				"nodeCode": "Main-Main-846",
				"orientation": "89.52",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "A",
				"nodeCode": "Main-Main-389",
				"orientation": "180.0",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 0,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ps-1",
				"nodeCode": "Main-Main-46",
				"orientation": "-89.89",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ps-2",
				"nodeCode": "Main-Main-47",
				"orientation": "-0.3",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ps-3",
				"nodeCode": "Main-Main-45",
				"orientation": "90.01",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "ATLAS_Spares",
				"nodeCode": "Main-Main-849",
				"orientation": "90.03",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			},
			{
				"containerCode": "PALLET_STACK_01",
				"nodeCode": "Main-Main-116",
				"orientation": "179.49",
				"containerModelCode": "Pallet",
				"emptyFullStatus": 0,
				"inMapStatus": 1,
				"isCarry": 0,
				"containerCheckCode": "",
				"mapCode": "Main",
				"districtCode": "Main",
				"customStatus": ""
			}
		],
		"code": "0",
		"message": null,
		"success": true
	}

	### HEADERS:

	Access-Control-Expose-Headers: *
	Access-Control-Allow-Origin: *
	Access-Control-Allow-Credentials: true
	Access-Control-Allow-Methods: *
	Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	Vary: Origin
	Vary: Access-Control-Request-Method
	Vary: Access-Control-Request-Headers
	Content-Type: application/json
	Transfer-Encoding: chunked
	Date: Sun, 03 May 2026 01:17:59 GMT

	### CONSOLE:

	* Preparing request to http://<SERVER_IP>:<SERVER_PORT>/api/amr/containerQueryAll
	* Current time is 2026-05-03T01:18:01.839Z
	* Enable automatic URL encoding
	* Using default HTTP version
	* Enable timeout of 30000ms
	* Enable SSL validation
	* Too old connection (223 seconds idle), disconnect it
	* Connection 34 seems to be dead
	* Closing connection 34
	* Hostname in DNS cache was stale, zapped
	*   Trying <SERVER_IP>:<SERVER_PORT>...
	* Connected to <SERVER_IP> (<SERVER_IP>) port <SERVER_PORT> (#35)

	> POST /api/amr/containerQueryAll HTTP/1.1
	> Host: <SERVER_IP>:<SERVER_PORT>
	> Authorization: AUTH_KEY
	> Content-Type: application/json
	> Accept: */*
	> Content-Length: 88

	| {
	| 	"containerCode": "",
	| 	"containerModelCode": "",
	| 	"nodeCode": "",
	| 	"inMapStatus": ""
	| }

	* Mark bundle as not supporting multiuse

	< HTTP/1.1 200 
	< Access-Control-Expose-Headers: *
	< Access-Control-Allow-Origin: *
	< Access-Control-Allow-Credentials: true
	< Access-Control-Allow-Methods: *
	< Access-Control-Allow-Headers: language, Origin, No-Cache, X-Requested-With, If-Modified-Since, Pragma, Last-Modified, Cache-Control, Expires, Content-Type, X-E4M-With,userId,Authorization,SessionToken,JSESSIONID,token,Wizards
	< Vary: Origin
	< Vary: Access-Control-Request-Method
	< Vary: Access-Control-Request-Headers
	< Content-Type: application/json
	< Transfer-Encoding: chunked
	< Date: Sun, 03 May 2026 01:17:59 GMT


	* Received 3.1 KB chunk
	* Received 5.5 KB chunk
	* Received 1222 B chunk
	* Connection #35 to host <SERVER_IP> left intact

	### Response status:

	200	OK	Response
	201	Created	
	401	Unauthorized	
	403	Forbidden	
	404	Not Found