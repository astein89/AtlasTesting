## MultiStop Mission

### Same calls as Rack Move
	- containerIn
	- submitMission
	- jobQuery
	- containerOut
	
	
### Concept
	- Create separate missions for each step
		- Each step has a pair, Start > End
			- sequence 1/2
			- Start for stop 2+ is always the end of the last
		- Wait for user input to continue to next move
	- For all missions but the last, need to set "lockRobotAfterFinish" = true in submitMission
		- need to set false for single missions and last mission in MultiStop
		- After first mission need to get the robot assigned to the mission using jobQuery, this then gets used for subsequent missions with same robot with the "unlockRobotId" field in submitMission
	- Only do containerOut after the final part of the mission
	- On mission page indicate that the mission is a multistop mission, and once the first step of the mission is complete flag as waiting, and have a continue mission button that triggers next stage of mission
		- I want the ability to add new stops or modify the destinations during each step.
		- Should say somthing like move to next stop, add stop, move to final stop
	- I want to see all parts of the mission in the mission screen for this type.
	
		

### Mission Creation
	- Stop 1
		- Move to location to pickup pallet
			- putDown = false
		- Move to destination
			- putDown = false
		- Wait for user input to continue to next stop
		- get robot id for the mission
			- error mission if no robto assigned
	- Stop 2+
		- Use same container
		- use same robot 
		- start = end of previous stop
			- putDown = false
		- Move to destination
			- selectable putDown
		- Wait for user input to continue to next stop
	- Final Stop
		- Use same container
		- use same robot 
		- start = end of previous stop
			- putDown = false
		- Move to destination
			- putDown = true
		- Mission complete
		- call containerOut